const Joi = require('joi');

// Property validation schema
const propertySchema = Joi.object({
    name: Joi.string().max(200).allow(''),
    type: Joi.string().valid('apartment', 'house', 'studio', 'loft', 'villa', '').allow(''),
    address: Joi.string().max(500).allow(''),
    description: Joi.string().max(2000).allow(''),
    maxGuests: Joi.number().integer().min(1).max(20),
    bedrooms: Joi.number().integer().min(0).max(10),
    beds: Joi.number().integer().min(0).max(20),
    bathrooms: Joi.number().min(0).max(10),
    amenities: Joi.object().pattern(
        Joi.string(),
        Joi.object({
            enabled: Joi.boolean(),
            ssid: Joi.string().allow(''),
            password: Joi.string().allow(''),
            speed: Joi.string().allow(''),
            areas: Joi.string().allow(''),
            type: Joi.string().allow(''),
            instructions: Joi.string().allow(''),
            equipment: Joi.string().allow(''),
            utensils: Joi.string().allow(''),
            spaces: Joi.number().allow(''),
            location: Joi.string().allow(''),
            channels: Joi.string().allow(''),
            streaming: Joi.string().allow('')
        }).unknown(true)
    ),
    customFields: Joi.array().items(
        Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required()
        })
    ),
    lastUpdated: Joi.string().isoDate(),
    updatedBy: Joi.string()
}).unknown(true);

// Q&A validation schema
const qaSchema = Joi.object({
    guest_question: Joi.string().required().min(3).max(500),
    bot_answer: Joi.string().required().min(3).max(2000),
    category: Joi.string().valid('check-in', 'amenities', 'rules', 'location', 'other', '').allow('')
});

// Validation middleware for property
const validateProperty = (req, res, next) => {
    const { error } = propertySchema.validate(req.body);
    if (error) {
        return res.status(400).json({ 
            error: 'Validation error', 
            details: error.details[0].message 
        });
    }
    next();
};

// Validation middleware for Q&A
const validateQA = (req, res, next) => {
    const { error } = qaSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ 
            error: 'Validation error', 
            details: error.details[0].message 
        });
    }
    next();
};

module.exports = {
    validateProperty,
    validateQA
};