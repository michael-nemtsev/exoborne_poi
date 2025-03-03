const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();

// Log startup information
console.log('Starting server...');
console.log('Node version:', process.version);
console.log('Current directory:', __dirname);
console.log('Process directory:', process.cwd());

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Update file paths for POIs
const DRAFT_FILE = path.join(__dirname, '../pois/pois-draft.json');

// Ensure directories exist
const poisDir = path.dirname(DRAFT_FILE);
if (!fs.existsSync(poisDir)) {
    console.log(`Creating pois directory: ${poisDir}`);
    try {
        fs.mkdirSync(poisDir, { recursive: true });
        console.log('Successfully created pois directory');
    } catch (err) {
        console.error('Error creating pois directory:', err);
    }
}

// Initialize draft file if it doesn't exist
if (!fs.existsSync(DRAFT_FILE)) {
    console.log(`Creating file: ${DRAFT_FILE}`);
    try {
        fs.writeFileSync(DRAFT_FILE, '[]', 'utf8');
        console.log(`Successfully created file: ${DRAFT_FILE}`);
    } catch (err) {
        console.error(`Error creating file ${DRAFT_FILE}:`, err);
    }
}

// Test endpoint
app.get('/api/test', (req, res) => {
    console.log('Test endpoint called');
    res.json({ 
        message: 'API Server is running!',
        nodeVersion: process.version,
        currentDirectory: __dirname,
        processDirectory: process.cwd()
    });
});

// API endpoint to check pois directory
app.get('/api/check-pois', (req, res) => {
    const exists = fs.existsSync(poisDir);
    
    let files = [];
    if (exists) {
        try {
            files = fs.readdirSync(poisDir);
        } catch (err) {
            console.error('Error reading pois directory:', err);
        }
    }
    
    res.json({
        poisDirExists: exists,
        poisDirPath: poisDir,
        files: files,
        currentDir: __dirname,
        rootDir: path.join(__dirname, '..')
    });
});

// Health check endpoint for Azure
app.get('/health', (req, res) => {
    console.log('Health check endpoint called');
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version
    });
});

// Get draft POIs
app.get('/api/pois-draft', (req, res) => {
    console.log('Getting draft POIs');
    if (fs.existsSync(DRAFT_FILE)) {
        try {
            const data = fs.readFileSync(DRAFT_FILE, 'utf8');
            res.json(JSON.parse(data));
        } catch (err) {
            console.error('Error reading draft POIs:', err);
            res.status(500).json({ error: 'Failed to read draft POIs', details: err.message });
        }
    } else {
        res.json([]);
    }
});

// Save POI to draft
app.post('/api/save-poi', (req, res) => {
    console.log('Received POI request:', req.body);

    const poi = req.body;
    try {
        // Read existing POIs
        let pois = [];
        if (fs.existsSync(DRAFT_FILE)) {
            const fileContent = fs.readFileSync(DRAFT_FILE, 'utf8');
            if (fileContent) {
                pois = JSON.parse(fileContent);
            }
        }

        // Add new POI
        pois.push(poi);

        // Save back to file
        fs.writeFileSync(DRAFT_FILE, JSON.stringify(pois, null, 2));
        console.log('Successfully saved POI');
        res.json({ success: true });
    } catch (err) {
        console.error('Error handling POI save:', err);
        res.status(500).json({ error: 'Failed to save POI', details: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
const PORT = process.env.PORT || 8080; // Azure Web Apps expects 8080
const server = app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT}`);
    console.log(`Test the server by visiting http://localhost:${PORT}/api/test`);
    
    // Log directory structure for debugging
    console.log('Current directory:', __dirname);
    console.log('Root directory:', path.join(__dirname, '..'));
    
    // Check if pois directory exists
    console.log('Pois directory exists:', fs.existsSync(poisDir));
    
    // List files in pois directory if it exists
    if (fs.existsSync(poisDir)) {
        console.log('Files in pois directory:', fs.readdirSync(poisDir));
    }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
}); 