const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { validateQA } = require('../middleware/validation');
const router = express.Router();

const QA_LOG_PATH = path.join(__dirname, '../../../data/qa_log.json');

// Get all Q&As
router.get('/', authMiddleware, async (req, res) => {
    try {
        const data = await fs.readFile(QA_LOG_PATH, 'utf-8');
        const qaList = JSON.parse(data);
        
        // Add IDs if not present
        const qaWithIds = qaList.map((qa, index) => ({
            id: qa.id || `qa_${Date.now()}_${index}`,
            ...qa,
            created_at: qa.created_at || new Date().toISOString(),
            usage_count: qa.usage_count || 0
        }));
        
        res.json(qaWithIds);
    } catch (error) {
        console.error('Error reading Q&A data:', error);
        
        if (error.code === 'ENOENT') {
            res.json([]);
        } else {
            res.status(500).json({ error: 'Error loading Q&A data' });
        }
    }
});

// Add new Q&A
router.post('/', authMiddleware, validateQA, async (req, res) => {
    try {
        const newQA = {
            id: `qa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            guest_question: req.body.guest_question,
            bot_answer: req.body.bot_answer,
            category: req.body.category || 'other',
            created_at: new Date().toISOString(),
            usage_count: 0,
            active: true
        };
        
        // Read current data
        let qaList = [];
        try {
            const data = await fs.readFile(QA_LOG_PATH, 'utf-8');
            qaList = JSON.parse(data);
        } catch (error) {
            // File doesn't exist, start with empty array
        }
        
        // Add new Q&A
        qaList.push(newQA);
        
        // Save updated data
        await fs.writeFile(
            QA_LOG_PATH,
            JSON.stringify(qaList, null, 2),
            'utf-8'
        );
        
        res.status(201).json({
            success: true,
            message: 'Q&A added successfully',
            data: newQA
        });
        
    } catch (error) {
        console.error('Error adding Q&A:', error);
        res.status(500).json({ error: 'Error saving Q&A' });
    }
});

// Update Q&A
router.put('/:id', authMiddleware, validateQA, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Read current data
        const data = await fs.readFile(QA_LOG_PATH, 'utf-8');
        let qaList = JSON.parse(data);
        
        // Find and update Q&A
        const qaIndex = qaList.findIndex(qa => qa.id === id);
        if (qaIndex === -1) {
            return res.status(404).json({ error: 'Q&A not found' });
        }
        
        qaList[qaIndex] = {
            ...qaList[qaIndex],
            guest_question: req.body.guest_question,
            bot_answer: req.body.bot_answer,
            category: req.body.category || qaList[qaIndex].category,
            updated_at: new Date().toISOString()
        };
        
        // Save updated data
        await fs.writeFile(
            QA_LOG_PATH,
            JSON.stringify(qaList, null, 2),
            'utf-8'
        );
        
        res.json({
            success: true,
            message: 'Q&A updated successfully',
            data: qaList[qaIndex]
        });
        
    } catch (error) {
        console.error('Error updating Q&A:', error);
        res.status(500).json({ error: 'Error updating Q&A' });
    }
});

// Delete Q&A
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Read current data
        const data = await fs.readFile(QA_LOG_PATH, 'utf-8');
        let qaList = JSON.parse(data);
        
        // Filter out the Q&A to delete
        const filteredList = qaList.filter(qa => qa.id !== id);
        
        if (filteredList.length === qaList.length) {
            return res.status(404).json({ error: 'Q&A not found' });
        }
        
        // Save updated data
        await fs.writeFile(
            QA_LOG_PATH,
            JSON.stringify(filteredList, null, 2),
            'utf-8'
        );
        
        res.json({
            success: true,
            message: 'Q&A deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting Q&A:', error);
        res.status(500).json({ error: 'Error deleting Q&A' });
    }
});

// Search Q&As
router.get('/search', authMiddleware, async (req, res) => {
    try {
        const { q, category } = req.query;
        
        const data = await fs.readFile(QA_LOG_PATH, 'utf-8');
        let qaList = JSON.parse(data);
        
        // Filter based on search criteria
        if (q) {
            qaList = qaList.filter(qa => 
                qa.guest_question.toLowerCase().includes(q.toLowerCase()) ||
                qa.bot_answer.toLowerCase().includes(q.toLowerCase())
            );
        }
        
        if (category) {
            qaList = qaList.filter(qa => qa.category === category);
        }
        
        res.json(qaList);
        
    } catch (error) {
        console.error('Error searching Q&A:', error);
        res.status(500).json({ error: 'Error searching Q&A' });
    }
});

module.exports = router;