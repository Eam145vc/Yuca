const Joi = require('joi');

// Validation schema for Q&A
const qaSchema = Joi.object({
    question: Joi.string()
        .required()
        .min(3)
        .max(500)
        .messages({
            'string.empty': 'La pregunta es requerida',
            'string.min': 'La pregunta debe tener al menos 3 caracteres',
            'string.max': 'La pregunta no puede exceder los 500 caracteres'
        }),
    
    answer: Joi.string()
        .required()
        .min(3)
        .max(1000)
        .messages({
            'string.empty': 'La respuesta es requerida',
            'string.min': 'La respuesta debe tener al menos 3 caracteres',
            'string.max': 'La respuesta no puede exceder los 1000 caracteres'
        }),
    
    category: Joi.string()
        .required()
        .valid('frequent', 'less_common', 'custom')
        .messages({
            'string.empty': 'La categoría es requerida',
            'any.only': 'Categoría inválida'
        })
});

// Middleware to validate Q&A
const validateQA = (req, res, next) => {
    const { error } = qaSchema.validate(req.body, { abortEarly: false });
    
    if (error) {
        const errors = error.details.map(detail => detail.message);
        return res.status(400).json({
            error: 'Validation error',
            details: errors
        });
    }
    
    next();
};
const validateProperty = (req, res, next) => {
    // TODO: implement property validation
    next();
};

module.exports = {
    validateQA,
    validateProperty
};