const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Update file paths
const POIS_FILE = path.join(__dirname, '../pois/pois.json');
const DRAFT_FILE = path.join(__dirname, '../pois/pois-draft.json');

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// Endpoint to save POIs
app.post('/api/save-poi', (req, res) => {
    console.log('Received POI request:', req.body);

    const poi = req.body;
    const filePath = DRAFT_FILE;

    // Read existing POIs
    let pois = [];
    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) {
                pois = JSON.parse(fileContent);
            }
        }
    } catch (err) {
        console.error('Error reading file:', err);
    }

    // Add new POI
    pois.push(poi);

    // Save back to file
    try {
        fs.writeFileSync(filePath, JSON.stringify(pois, null, 2));
        console.log('Successfully saved POI');
        res.json({ success: true });
    } catch (err) {
        console.error('Error writing file:', err);
        res.status(500).json({ error: 'Failed to save POI' });
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Test the server by visiting http://localhost:${PORT}/api/test`);
}); 