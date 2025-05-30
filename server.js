require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dashboardApp = require('./dashboard/backend/app');
const { setupDatabase } = require('./dashboard/backend/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Servir el dashboard
app.use('/dashboard', dashboardApp);

// Redirigir raíz al dashboard
app.get('/', (req, res) => {
    res.redirect('/dashboard');
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
            console.log(`🚀 AirbnBOT Server running on http://localhost:${PORT}`);
            console.log(`📊 Dashboard available at http://localhost:${PORT}/dashboard`);
            console.log(`💾 Database initialized successfully`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });