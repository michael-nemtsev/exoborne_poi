const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Update file paths - ensure they exist
const POIS_FILE = path.join(__dirname, '../pois/pois.json');
const DRAFT_FILE = path.join(__dirname, '../pois/pois-draft.json');

// Ensure directories exist
const poisDir = path.dirname(POIS_FILE);
if (!fs.existsSync(poisDir)) {
    fs.mkdirSync(poisDir, { recursive: true });
}

// Initialize files if they don't exist
[POIS_FILE, DRAFT_FILE].forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]', 'utf8');
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// Health check endpoint for Azure
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ message: 'Exoborne POI API is running' });
});

// Endpoint to save POIs
app.post('/api/save-poi', (req, res) => {
    console.log('Received POI request:', req.body);

    const poi = req.body;
    const filePath = DRAFT_FILE;

    try {
        // Read existing POIs
        let pois = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) {
                pois = JSON.parse(fileContent);
            }
        }

        // Add new POI
        pois.push(poi);

        // Save back to file
        fs.writeFileSync(filePath, JSON.stringify(pois, null, 2));
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
    console.log(`Server running on port ${PORT}`);
    console.log(`Test the server by visiting http://localhost:${PORT}/api/test`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
}); 