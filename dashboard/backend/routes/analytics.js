const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const QA_LOG_PATH = path.join(__dirname, '../../../data/qa_log.json');
const THREAD_STATES_PATH = path.join(__dirname, '../../../data/thread_states.json');

// Get analytics data
router.get('/', authMiddleware, async (req, res) => {
    try {
        // Read Q&A data
        const qaData = await fs.readFile(QA_LOG_PATH, 'utf-8');
        const qaList = JSON.parse(qaData);
        
        // Read thread states for more analytics
        let threadStates = {};
        try {
            const threadData = await fs.readFile(THREAD_STATES_PATH, 'utf-8');
            threadStates = JSON.parse(threadData);
        } catch (error) {
            // File might not exist yet
        }
        
        // Calculate statistics
        const today = new Date().toDateString();
        const todayResponses = Object.values(threadStates).reduce((count, thread) => {
            if (thread.lastActivity && new Date(thread.lastActivity).toDateString() === today) {
                return count + 1;
            }
            return count;
        }, 0);
        
        const escalations = Object.values(threadStates).reduce((count, thread) => {
            if (thread.pendingHostRequests && thread.pendingHostRequests.length > 0) {
                return count + thread.pendingHostRequests.length;
            }
            return count;
        }, 0);
        
        // Get top questions (mock data for now)
        const topQuestions = [
            { text: "¿Cuál es la contraseña del WiFi?", count: 45 },
            { text: "¿A qué hora es el check-in?", count: 38 },
            { text: "¿Dónde está el parqueadero?", count: 32 },
            { text: "¿Cómo funciona el aire acondicionado?", count: 28 },
            { text: "¿Hay toallas disponibles?", count: 24 }
        ];
        
        // Response rate calculation
        const totalQuestions = qaList.length;
        const answeredQuestions = qaList.filter(qa => qa.bot_answer).length;
        const responseRate = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
        
        // Chart data for last 7 days
        const chartData = {
            labels: [],
            responseRates: []
        };
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            chartData.labels.push(date.toLocaleDateString('es-CO', { weekday: 'short' }));
            chartData.responseRates.push(Math.floor(Math.random() * 20) + 75); // Mock data
        }
        
        res.json({
            stats: {
                totalQA: qaList.length,
                todayResponses,
                escalations,
                responseRate
            },
            topQuestions,
            chartData
        });
        
    } catch (error) {
        console.error('Error loading analytics:', error);
        res.status(500).json({ error: 'Error loading analytics data' });
    }
});

// Get response metrics
router.get('/metrics', authMiddleware, async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        
        // Mock metrics data
        const metrics = {
            averageResponseTime: '2.3 segundos',
            successRate: '89%',
            mostActiveHours: ['14:00', '15:00', '20:00'],
            questionsPerDay: 12.5
        };
        
        res.json(metrics);
        
    } catch (error) {
        console.error('Error getting metrics:', error);
        res.status(500).json({ error: 'Error loading metrics' });
    }
});

module.exports = router;