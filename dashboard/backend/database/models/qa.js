const { db, useMongo } = require('../index');
const mongoose = require('mongoose');

let QAItem;
if (useMongo) {
  const qaSchema = new mongoose.Schema({
    question: { type: String, required: true },
    answer:   { type: String, required: true },
    category: { type: String, required: true },
    active:   { type: Boolean, default: true },
    created_at:{ type: Date, default: Date.now },
    updated_at:{ type: Date, default: Date.now }
  });
  QAItem = mongoose.model('QAItem', qaSchema);
}

// Obtener todas las preguntas y respuestas
const getAllQA = async () => {
  if (useMongo) {
    return QAItem.find().sort({ category: 1, created_at: 1 }).lean();
  }
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM qa_items ORDER BY category, id', (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// Obtener preguntas por categoría
const getQAByCategory = async (category) => {
  if (useMongo) {
    return QAItem.find({ category }).sort({ created_at: 1 }).lean();
  }
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM qa_items WHERE category = ? ORDER BY id', [category], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// Crear nueva pregunta
const createQA = async (question, answer, category) => {
  const now = new Date().toISOString();
  if (useMongo) {
    const created = await QAItem.create({ question, answer, category, created_at: now, updated_at: now });
    return {
      id: created._id,
      question: created.question,
      answer: created.answer,
      category: created.category,
      created_at: created.created_at,
      updated_at: created.updated_at
    };
  }
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO qa_items (question, answer, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [question, answer, category, now, now],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            question,
            answer,
            category,
            created_at: now,
            updated_at: now
          });
        }
      }
    );
  });
};

// Actualizar pregunta existente
const updateQA = async (id, question, answer, category) => {
  const now = new Date().toISOString();
  if (useMongo) {
    const updated = await QAItem.findByIdAndUpdate(id, { question, answer, category, updated_at: now }, { new: true });
    if (!updated) {
      throw new Error('Q&A not found');
    }
    return {
      id: updated._id,
      question: updated.question,
      answer: updated.answer,
      category: updated.category,
      updated_at: updated.updated_at
    };
  }
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE qa_items SET question = ?, answer = ?, category = ?, updated_at = ? WHERE id = ?',
      [question, answer, category, now, id],
      function(err) {
        if (err) {
          reject(err);
        } else if (this.changes === 0) {
          reject(new Error('Q&A not found'));
        } else {
          resolve({
            id,
            question,
            answer,
            category,
            updated_at: now
          });
        }
      }
    );
  });
};

// Eliminar pregunta
const deleteQA = async (id) => {
  if (useMongo) {
    const deleted = await QAItem.findByIdAndDelete(id);
    if (!deleted) {
      throw new Error('Q&A not found');
    }
    return { id };
  }
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM qa_items WHERE id = ?', [id], function(err) {
      if (err) {
        reject(err);
      } else if (this.changes === 0) {
        reject(new Error('Q&A not found'));
      } else {
        resolve({ id });
      }
    });
  });
};

module.exports = {
  getAllQA,
  getQAByCategory,
  createQA,
  updateQA,
  deleteQA
};