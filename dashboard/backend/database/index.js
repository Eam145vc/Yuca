const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Crear conexión a la base de datos
const dbPath = path.join(__dirname, '../../../data/airbnbot.db');
const db = new sqlite3.Database(dbPath);

// Inicializar la base de datos
const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Crear tabla de Q&A
      db.run(`
        CREATE TABLE IF NOT EXISTS qa_items (
          id INTEGER PRIMARY KEY,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          category TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Error creating qa_items table:', err);
          reject(err);
        } else {
          console.log('Database initialized successfully');
          resolve();
        }
      });
    });
  });
};

// Insertar datos de ejemplo
const seedQAData = () => {
  return new Promise((resolve, reject) => {
    // Verificar si ya hay datos
    db.get('SELECT COUNT(*) as count FROM qa_items', (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Si ya hay datos, no insertar de nuevo
      if (row.count > 0) {
        resolve();
        return;
      }
      
      // Datos de ejemplo para preguntas frecuentes
      const frequentQuestions = [
        {
          question: '¿Cuántas habitaciones tiene el alojamiento?',
          answer: '3 habitaciones en total: 2 con cama matrimonial y 1 con dos camas individuales.',
          category: 'frequent'
        },
        {
          question: '¿Cuántas camas hay disponibles?',
          answer: '4 camas en total: 2 matrimoniales y 2 individuales.',
          category: 'frequent'
        },
        {
          question: '¿Cuál es el horario de check-in?',
          answer: 'El check-in es a partir de las 3:00 PM. Se puede coordinar una hora diferente con anticipación.',
          category: 'frequent'
        },
        {
          question: '¿Cuál es el horario de check-out?',
          answer: 'El check-out es hasta las 11:00 AM. Se puede solicitar late check-out con costo adicional.',
          category: 'frequent'
        },
        {
          question: '¿Hay WiFi disponible?',
          answer: 'Sí, contamos con WiFi de alta velocidad en todo el alojamiento. La contraseña se encuentra en el manual de bienvenida.',
          category: 'frequent'
        },
        {
          question: '¿Hay estacionamiento disponible?',
          answer: 'Sí, contamos con un espacio de estacionamiento gratuito dentro de la propiedad.',
          category: 'frequent'
        },
        {
          question: '¿Cuál es la capacidad máxima de personas?',
          answer: 'La capacidad máxima es de 6 personas, incluyendo niños mayores de 2 años.',
          category: 'frequent'
        },
        {
          question: '¿Está permitido fumar?',
          answer: 'No está permitido fumar dentro del alojamiento. Hay un área designada en la terraza.',
          category: 'frequent'
        },
        {
          question: '¿Se permiten mascotas?',
          answer: 'Lo sentimos, no se permiten mascotas en el alojamiento.',
          category: 'frequent'
        },
        {
          question: '¿Hay aire acondicionado?',
          answer: 'Sí, todas las habitaciones cuentan con aire acondicionado individual.',
          category: 'frequent'
        }
      ];
      
      // Datos de ejemplo para preguntas menos comunes
      const lessCommonQuestions = [
        {
          question: '¿Hay acceso a la playa?',
          answer: 'La playa más cercana está a 10 minutos caminando desde el alojamiento.',
          category: 'less_common'
        },
        {
          question: '¿Hay secador de pelo disponible?',
          answer: 'Sí, hay un secador de pelo en cada baño.',
          category: 'less_common'
        },
        {
          question: '¿Hay plancha disponible?',
          answer: 'Sí, contamos con plancha y tabla de planchar en el armario del pasillo.',
          category: 'less_common'
        },
        {
          question: '¿Hay lavadora/secadora?',
          answer: 'Sí, hay lavadora disponible para uso de los huéspedes. No contamos con secadora.',
          category: 'less_common'
        },
        {
          question: '¿Hay ascensor en el edificio?',
          answer: 'No, el edificio no cuenta con ascensor. El apartamento está en el segundo piso.',
          category: 'less_common'
        },
        {
          question: '¿Qué tan lejos está el supermercado más cercano?',
          answer: 'El supermercado más cercano está a 2 cuadras (5 minutos caminando).',
          category: 'less_common'
        },
        {
          question: '¿Hay transporte público cercano?',
          answer: 'Sí, hay una parada de autobús a 1 cuadra y la estación de metro está a 10 minutos caminando.',
          category: 'less_common'
        },
        {
          question: '¿Hay cuna o silla alta para bebés?',
          answer: 'Podemos proporcionar una cuna portátil y silla alta con previo aviso.',
          category: 'less_common'
        },
        {
          question: '¿Hay servicio de limpieza durante la estadía?',
          answer: 'Para estadías de más de 7 noches, ofrecemos un servicio de limpieza gratuito a mitad de la estadía.',
          category: 'less_common'
        },
        {
          question: '¿Hay detector de humo o extintor?',
          answer: 'Sí, contamos con detectores de humo en todas las habitaciones y extintores en la cocina y el pasillo.',
          category: 'less_common'
        }
      ];
      
      // Insertar todas las preguntas
      const allQuestions = [...frequentQuestions, ...lessCommonQuestions];
      
      const stmt = db.prepare('INSERT INTO qa_items (question, answer, category) VALUES (?, ?, ?)');
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        allQuestions.forEach(q => {
          stmt.run(q.question, q.answer, q.category);
        });
        
        db.run('COMMIT', (err) => {
          if (err) {
            reject(err);
          } else {
            console.log(`Inserted ${allQuestions.length} sample Q&A items`);
            resolve();
          }
        });
      });
      
      stmt.finalize();
    });
  });
};

// Inicializar y sembrar datos
const setupDatabase = async () => {
  try {
    await initDatabase();
    await seedQAData();
    console.log('Database setup completed successfully');
  } catch (error) {
    console.error('Database setup failed:', error);
  }
};

// Exportar funciones y conexión
module.exports = {
  db,
  setupDatabase
};