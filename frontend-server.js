require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const dashboardApp = require('./dashboard/backend/app');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        'https://fronted-airbnbot.onrender.com',
        'https://bot-root-airbnbot.onrender.com',
        'https://yuca.onrender.com'
    ],
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Serve the dashboard at the root path
app.use('/', (req, res, next) => {
    console.log(`[DEBUG] Frontend root request: ${req.url} from host: ${req.get('host')}`);
    next();
}, dashboardApp);

// Also serve the dashboard at /dashboard for consistency
app.use('/dashboard', (req, res, next) => {
    console.log(`[DEBUG] Frontend dashboard request: ${req.url} from host: ${req.get('host')}`);
    next();
}, dashboardApp);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'frontend',
        dashboard: 'active'
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Frontend Server running on port ${PORT}`);
    console.log(`📊 Dashboard available at / and /dashboard`);
});