const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https:"],
        },
    },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});

app.use('/api/', limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Import routes with error handling
try {
    const authRoutes = require('./routes/auth');
    const propertyRoutes = require('./routes/property');
    const qaRoutes = require('./routes/qa');
    const analyticsRoutes = require('./routes/analytics');
    const airbnbRoutes = require('./routes/airbnb');
    
    // API Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/property', propertyRoutes);
    app.use('/api/qa', qaRoutes);
    app.use('/api/analytics', analyticsRoutes);
    app.use('/api/airbnb', airbnbRoutes);
} catch (error) {
    console.warn('⚠️ Some routes not found. Using basic routes...');
    console.error('Error details:', error.message);
    
    // Basic routes for testing
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', message: 'Dashboard API is running' });
    });
}

// Serve dashboard HTML for all non-API routes
app.get('*', (req, res) => {
    console.log(`[DEBUG] Dashboard backend serving HTML for: ${req.url} from host: ${req.get('host')}`);
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal server error',
            status: err.status || 500
        }
    });
});

module.exports = app;