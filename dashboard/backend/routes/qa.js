const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { validateQA } = require('../middleware/validation');
const qaModel = require('../database/models/qa');

const router = express.Router();

// Obtener todas las Q&As
router.get('/', authMiddleware, async (req, res) => {
  try {
    const qaList = await qaModel.getAllQA();
    res.json(qaList);
  } catch (error) {
    console.error('Error reading Q&A data:', error);
    res.status(500).json({ error: 'Error loading Q&A data' });
  }
});

// Obtener Q&As por categoría
router.get('/category/:category', authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const qaList = await qaModel.getQAByCategory(category);
    res.json(qaList);
  } catch (error) {
    console.error('Error reading Q&A data by category:', error);
    res.status(500).json({ error: 'Error loading Q&A data' });
  }
});

// Agregar nueva Q&A
router.post('/', authMiddleware, validateQA, async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    const newQA = await qaModel.createQA(question, answer, category || 'custom');
    
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

// Actualizar Q&A
router.put('/:id', authMiddleware, validateQA, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category } = req.body;
    
    const updatedQA = await qaModel.updateQA(id, question, answer, category);
    
    res.json({
      success: true,
      message: 'Q&A updated successfully',
      data: updatedQA
    });
  } catch (error) {
    console.error('Error updating Q&A:', error);
    
    if (error.message === 'Q&A not found') {
      res.status(404).json({ error: 'Q&A not found' });
    } else {
      res.status(500).json({ error: 'Error updating Q&A' });
    }
  }
});

// Eliminar Q&A
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await qaModel.deleteQA(id);
    
    res.json({
      success: true,
      message: 'Q&A deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting Q&A:', error);
    
    if (error.message === 'Q&A not found') {
      res.status(404).json({ error: 'Q&A not found' });
    } else {
      res.status(500).json({ error: 'Error deleting Q&A' });
    }
  }
});

// Dashboard route
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    // Placeholder for dashboard data
    res.json({ message: 'Dashboard is accessible' });
  } catch (error) {
    console.error('Error accessing dashboard:', error);
    res.status(500).json({ error: 'Error accessing dashboard' });
  }
});

module.exports = router;