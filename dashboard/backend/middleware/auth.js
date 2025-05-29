const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const authMiddleware = (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header provided' });
        }
        
        const token = authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Add decoded token to request
        req.user = decoded;
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

// Optional auth middleware (doesn't fail if no token)
const optionalAuthMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            if (token) {
                const decoded = jwt.verify(token, JWT_SECRET);
                req.user = decoded;
            }
        }
        
        next();
    } catch (error) {
        // Continue without authentication
        next();
    }
};

module.exports = {
    authMiddleware,
    optionalAuthMiddleware
};