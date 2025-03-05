const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Add specific endpoint for pois.json
app.get('/api/pois-approved', (req, res) => {
    const filePath = path.join(__dirname, '../pois/pois.json');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error('pois.json file not found at:', filePath);
        res.status(404).json({ error: 'POIs file not found' });
    }
});

// Add echo endpoint
app.get('/pois/echo.json', (req, res) => {
    res.json({ status: 'OK' });
});

// Add specific endpoint for pois-draft.json
app.get('/api/pois-draft', (req, res) => {
    const filePath = path.join(__dirname, '../pois/pois-draft.json');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error('pois-draft.json file not found at:', filePath);
        res.status(404).json({ error: 'POIs draft file not found' });
    }
});

// Update file paths - ensure they exist
const POIS_FILE = path.join(__dirname, '../pois/pois.json');
const DRAFT_FILE = path.join(__dirname, '../pois/pois-draft.json');

// Ensure directories exist
const poisDir = path.dirname(POIS_FILE);
if (!fs.existsSync(poisDir)) {
    console.log(`Creating pois directory: ${poisDir}`);
    try {
        fs.mkdirSync(poisDir, { recursive: true });
        console.log('Successfully created pois directory');
    } catch (err) {
        console.error('Error creating pois directory:', err);
    }
}

// Initialize files if they don't exist
[POIS_FILE, DRAFT_FILE].forEach(file => {
    if (!fs.existsSync(file)) {
        console.log(`Creating file: ${file}`);
        try {
            fs.writeFileSync(file, '[]', 'utf8');
            console.log(`Successfully created file: ${file}`);
        } catch (err) {
            console.error(`Error creating file ${file}:`, err);
        }
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// API endpoint to check pois directory
app.get('/api/check-pois', (req, res) => {
    const poisDir = path.join(__dirname, '../pois');
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
    res.status(200).json({ status: 'healthy' });
});

// Root endpoint - serve the HTML file instead of JSON response
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../default.html'));
});

// Endpoint to save POIs
app.post('/api/save-poi', (req, res) => {
    console.log('Received POI request:', req.body);

    const poi = req.body;
    if (!poi || !poi.id) {
        console.error('Invalid POI data received');
        return res.status(400).json({ success: false, error: 'Valid POI data is required' });
    }

    const filePath = DRAFT_FILE;

    try {
        // Ensure the directory exists
        if (!fs.existsSync(path.dirname(filePath))) {
            console.log(`Creating directory: ${path.dirname(filePath)}`);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }

        // Read existing POIs
        let pois = [];
        if (fs.existsSync(filePath)) {
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                if (fileContent && fileContent.trim()) {
                    pois = JSON.parse(fileContent);
                }
                console.log(`Read ${pois.length} POIs from draft file`);
            } catch (parseError) {
                console.error('Error parsing POIs file:', parseError);
                return res.status(500).json({ success: false, error: 'Error parsing POIs file' });
            }
        } else {
            console.log(`Draft file does not exist, creating new file: ${filePath}`);
        }

        // Remove the action property before saving
        const { action, ...cleanPoi } = poi;
        
        // Ensure approved status is false for draft POIs
        cleanPoi.approved = false;

        // Check if this POI already exists
        const existingIndex = pois.findIndex(p => p.id === cleanPoi.id);

        if (existingIndex !== -1) {
            // Update existing POI
            console.log(`Updating existing POI at index ${existingIndex} with ID: ${cleanPoi.id}`);
            
            // Update the existing POI with new properties
            pois[existingIndex] = { ...pois[existingIndex], ...cleanPoi };
            
            // Save the updated array
            fs.writeFileSync(filePath, JSON.stringify(pois, null, 2));
            console.log('Successfully updated POI');
            
            // Return success response with the updated POIs array
            res.json({ 
                success: true, 
                message: 'POI updated successfully',
                pois: pois
            });
        } else {
            // Add new POI
            console.log(`Adding new POI with ID: ${cleanPoi.id}`);
            
            // Add the new POI to the array
            pois.push(cleanPoi);
            
            // Save the updated array
            fs.writeFileSync(filePath, JSON.stringify(pois, null, 2));
            console.log('Successfully added new POI');
            
            // Return success response with the updated POIs array
            res.json({ 
                success: true, 
                message: 'POI added successfully',
                pois: pois
            });
        }
    } catch (err) {
        console.error('Error saving POI:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to delete POIs
app.post('/api/delete-poi', (req, res) => {
    console.log('Received POI delete request:', req.body);

    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ success: false, error: 'POI ID is required' });
    }

    const filePath = DRAFT_FILE;

    try {
        // Ensure the file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Draft POIs file not found' });
        }

        // Read existing POIs
        let pois = [];
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent && fileContent.trim()) {
                pois = JSON.parse(fileContent);
            }
        } catch (parseError) {
            console.error('Error parsing POIs file:', parseError);
            return res.status(500).json({ success: false, error: 'Error parsing POIs file' });
        }

        // Check if the POI exists
        const poiIndex = pois.findIndex(p => p.id === id);
        if (poiIndex === -1) {
            return res.status(404).json({ success: false, error: 'POI not found' });
        }

        // Remove the POI
        pois.splice(poiIndex, 1);

        // Save back to file
        fs.writeFileSync(filePath, JSON.stringify(pois, null, 2));
        console.log('Successfully deleted POI');
        
        res.json({ 
            success: true, 
            message: 'POI deleted successfully',
            pois: pois
        });
    } catch (err) {
        console.error('Error deleting POI:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to approve POIs
app.post('/api/approve-poi', (req, res) => {
    console.log('Received POI approval request:', req.body);

    const poi = req.body;
    if (!poi || !poi.id) {
        console.error('Invalid POI data received for approval');
        return res.status(400).json({ success: false, error: 'Valid POI data is required' });
    }

    try {
        // Ensure both files exist
        if (!fs.existsSync(DRAFT_FILE)) {
            console.error(`Draft file not found: ${DRAFT_FILE}`);
            return res.status(404).json({ success: false, error: 'Draft POIs file not found' });
        }
        if (!fs.existsSync(POIS_FILE)) {
            // Create the approved POIs file if it doesn't exist
            console.log(`Creating approved POIs file: ${POIS_FILE}`);
            fs.writeFileSync(POIS_FILE, '[]', 'utf8');
        }

        // Read draft POIs
        let draftPois = [];
        try {
            const draftContent = fs.readFileSync(DRAFT_FILE, 'utf8');
            if (draftContent && draftContent.trim()) {
                draftPois = JSON.parse(draftContent);
            }
            console.log(`Read ${draftPois.length} POIs from draft file`);
        } catch (parseError) {
            console.error('Error parsing draft POIs file:', parseError);
            return res.status(500).json({ success: false, error: 'Error parsing draft POIs file' });
        }

        // Read approved POIs
        let approvedPois = [];
        try {
            const approvedContent = fs.readFileSync(POIS_FILE, 'utf8');
            if (approvedContent && approvedContent.trim()) {
                approvedPois = JSON.parse(approvedContent);
            }
            console.log(`Read ${approvedPois.length} POIs from approved file`);
        } catch (parseError) {
            console.error('Error parsing approved POIs file:', parseError);
            return res.status(500).json({ success: false, error: 'Error parsing approved POIs file' });
        }

        // Find the POI in the draft file
        const draftIndex = draftPois.findIndex(p => p.id === poi.id);
        if (draftIndex === -1) {
            // If not found in draft, check if it's already in the approved file
            const approvedIndex = approvedPois.findIndex(p => p.id === poi.id);
            if (approvedIndex !== -1) {
                console.log(`POI ${poi.id} is already approved`);
                return res.json({
                    success: true,
                    message: 'POI is already approved',
                    draftPois: draftPois,
                    approvedPois: approvedPois
                });
            }
            console.error(`POI ${poi.id} not found in draft file`);
            return res.status(404).json({ success: false, error: 'POI not found in draft file' });
        }

        console.log(`Found POI ${poi.id} in draft file at index ${draftIndex}`);
        
        // Remove the POI from draft file
        const poiToApprove = { ...draftPois[draftIndex] };
        draftPois.splice(draftIndex, 1);
        
        // Ensure approved status is set to true
        poiToApprove.approved = true;
        
        // Remove any action property if it exists
        const { action, ...cleanPoi } = poiToApprove;
        
        // Check if this POI already exists in the approved file
        const approvedIndex = approvedPois.findIndex(p => p.id === poi.id);
        if (approvedIndex !== -1) {
            // Update existing approved POI
            console.log(`Updating existing approved POI at index ${approvedIndex}`);
            approvedPois[approvedIndex] = cleanPoi;
        } else {
            // Add to approved POIs
            console.log(`Adding new approved POI`);
            approvedPois.push(cleanPoi);
        }

        // Save both files
        console.log(`Saving ${draftPois.length} POIs to draft file`);
        fs.writeFileSync(DRAFT_FILE, JSON.stringify(draftPois, null, 2));
        
        console.log(`Saving ${approvedPois.length} POIs to approved file`);
        fs.writeFileSync(POIS_FILE, JSON.stringify(approvedPois, null, 2));
        
        console.log('Successfully approved POI');
        
        res.json({ 
            success: true, 
            message: 'POI approved successfully',
            draftPois: draftPois,
            approvedPois: approvedPois
        });
    } catch (err) {
        console.error('Error approving POI:', err);
        res.status(500).json({ success: false, error: err.message });
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
    
    // Log directory structure for debugging
    console.log('Current directory:', __dirname);
    console.log('Root directory:', path.join(__dirname, '..'));
    
    // Check if pois directory exists
    const poisDir = path.join(__dirname, '../pois');
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