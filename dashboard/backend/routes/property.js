const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { validateProperty } = require('../middleware/validation');
const router = express.Router();

const BUSINESS_DATA_PATH = path.join(__dirname, '../../../data/business_data.json');

// Get property data
router.get('/', authMiddleware, async (req, res) => {
    try {
        const data = await fs.readFile(BUSINESS_DATA_PATH, 'utf-8');
        const businessData = JSON.parse(data);
        
        res.json(businessData);
    } catch (error) {
        console.error('Error reading property data:', error);
        
        // Return empty object if file doesn't exist
        if (error.code === 'ENOENT') {
            res.json({});
        } else {
            res.status(500).json({ error: 'Error loading property data' });
        }
    }
});

// Update property data
router.post('/', authMiddleware, validateProperty, async (req, res) => {
    try {
        const updatedData = req.body;
        
        // Add metadata
        updatedData.lastUpdated = new Date().toISOString();
        updatedData.updatedBy = 'dashboard';
        
        // Save to file
        await fs.writeFile(
            BUSINESS_DATA_PATH, 
            JSON.stringify(updatedData, null, 2),
            'utf-8'
        );
        
        res.json({ 
            success: true, 
            message: 'Property data updated successfully',
            data: updatedData
        });
        
    } catch (error) {
        console.error('Error updating property data:', error);
        res.status(500).json({ error: 'Error saving property data' });
    }
});

// Get specific amenity details
router.get('/amenity/:amenityId', authMiddleware, async (req, res) => {
    try {
        const { amenityId } = req.params;
        const data = await fs.readFile(BUSINESS_DATA_PATH, 'utf-8');
        const businessData = JSON.parse(data);
        
        if (businessData.amenities && businessData.amenities[amenityId]) {
            res.json(businessData.amenities[amenityId]);
        } else {
            res.status(404).json({ error: 'Amenity not found' });
        }
    } catch (error) {
        console.error('Error reading amenity data:', error);
        res.status(500).json({ error: 'Error loading amenity data' });
    }
});

// Update specific amenity
router.put('/amenity/:amenityId', authMiddleware, async (req, res) => {
    try {
        const { amenityId } = req.params;
        const amenityData = req.body;
        
        // Read current data
        const data = await fs.readFile(BUSINESS_DATA_PATH, 'utf-8');
        const businessData = JSON.parse(data);
        
        // Update amenity
        if (!businessData.amenities) {
            businessData.amenities = {};
        }
        businessData.amenities[amenityId] = amenityData;
        businessData.lastUpdated = new Date().toISOString();
        
        // Save updated data
        await fs.writeFile(
            BUSINESS_DATA_PATH, 
            JSON.stringify(businessData, null, 2),
            'utf-8'
        );
        
        res.json({ 
            success: true, 
            message: 'Amenity updated successfully',
            data: amenityData
        });
        
    } catch (error) {
        console.error('Error updating amenity:', error);
        res.status(500).json({ error: 'Error saving amenity data' });
    }
});

module.exports = router;