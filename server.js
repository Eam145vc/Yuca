require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dashboardApp = require('./dashboard/backend/app');
const { setupDatabase } = require('./dashboard/backend/database');

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

// Servir el dashboard
app.use('/dashboard', dashboardApp);

// Root path should not redirect to dashboard
app.get('/', (req, res) => {
    res.json({
        message: 'AirbnBOT API Server',
        info: 'This is the API server. To access the dashboard, go to /dashboard or use the frontend URL.',
        endpoints: {
            dashboard: '/dashboard',
            health: '/health'
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            dashboard: 'active',
            bot: 'active',
            database: 'active'
        }
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
setupDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`🚀 AirbnBOT Server running on https://yuca.onrender.com`);
            console.log(`📊 Dashboard available at https://yuca.onrender.com/dashboard`);
            console.log(`💾 Database initialized successfully`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });