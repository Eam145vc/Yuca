const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Default PIN (change this in production!)
const DEFAULT_PIN = process.env.DASHBOARD_PIN || '1234';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { pin } = req.body;
        
        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }
        
        // In production, store hashed PIN in database or env variable
        const isValidPin = pin === DEFAULT_PIN;
        
        if (!isValidPin) {
            return res.status(401).json({ error: 'Invalid PIN' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { authenticated: true, timestamp: Date.now() },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            success: true, 
            token,
            message: 'Login successful' 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify token endpoint
router.get('/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: true, decoded });
    } catch (error) {
        res.status(401).json({ valid: false, error: 'Invalid token' });
    }
});

module.exports = router;