const { db } = require('../index');

// Obtener todas las preguntas y respuestas
const getAllQA = () => {
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
const getQAByCategory = (category) => {
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
const createQA = (question, answer, category) => {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
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
const updateQA = (id, question, answer, category) => {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
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
const deleteQA = (id) => {
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