const mongoose = require('mongoose');

// Define Q&A Schema
const qaSchema = new mongoose.Schema({
  question:   { type: String, required: true },
  answer:     { type: String, required: true },
  category:   { type: String, required: true },
  active:     { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

const QAItem = mongoose.model('QAItem', qaSchema);

const getAllQA = () => {
  return QAItem.find().sort({ category: 1, created_at: 1 }).lean();
};

const getQAByCategory = (category) => {
  return QAItem.find({ category }).sort({ created_at: 1 }).lean();
};

const createQA = async (question, answer, category = 'custom') => {
  const doc = await QAItem.create({ question, answer, category });
  return doc.toObject();
};

const updateQA = async (id, question, answer, category) => {
  const updated = await QAItem.findByIdAndUpdate(
    id,
    { question, answer, category, updated_at: Date.now() },
    { new: true }
  );
  if (!updated) {
    throw new Error('Q&A not found');
  }
  return updated.toObject();
};

const deleteQA = async (id) => {
  const deleted = await QAItem.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Q&A not found');
  }
  return { id: deleted._id };
};

module.exports = {
  getAllQA,
  getQAByCategory,
  createQA,
  updateQA,
  deleteQA
};