require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dashboardApp = require('./dashboard/backend/app');
const { setupDatabase } = require('./dashboard/backend/database');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        'https://fronted-airbnbot.onrender.com', // Kept for backward compatibility during transition
        'https://bot-root-airbnbot.onrender.com',
        'https://yuca.onrender.com'
    ],
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Serve the dashboard directly instead of redirecting
app.use('/dashboard', (req, res, next) => {
  const host = req.get('host');
  console.log(`[DEBUG] Dashboard request from host: ${host} - Serving directly`);
  next();
});

// Servir el dashboard
app.use('/dashboard', dashboardApp);

// Root path with updated information
app.get('/', (req, res) => {
    const host = req.get('host');
    res.json({
        message: 'AirbnBOT API Server',
        info: 'This is the API server. The dashboard is now served directly from this service.',
        endpoints: {
            dashboard: `https://${host}/dashboard`,
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
            console.log(`📊 Dashboard now served directly at https://yuca.onrender.com/dashboard`);
            console.log(`📊 Dashboard also available at https://bot-root-airbnbot.onrender.com/dashboard`);
            console.log(`💾 Database initialized successfully`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });