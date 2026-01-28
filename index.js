require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        sender VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS bot_status (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(50) UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Save message to database
async function saveMessage(phoneNumber, message, sender) {
  try {
    // Get or create user
    let userResult = await pool.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [phoneNumber]
    );
    
    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'INSERT INTO users (phone_number) VALUES ($1) RETURNING id',
        [phoneNumber]
      );
    }
    
    const userId = userResult.rows[0].id;
    
    // Save conversation
    await pool.query(
      'INSERT INTO conversations (user_id, message, sender) VALUES ($1, $2, $3)',
      [userId, message, sender]
    );
  } catch (error) {
    console.error('Error saving message:', error);
  }
}

// Get conversation history
async function getConversationHistory(phoneNumber, limit = 10) {
  try {
    const result = await pool.query(`
      SELECT c.message, c.sender, c.timestamp
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      WHERE u.phone_number = $1
      ORDER BY c.timestamp DESC
      LIMIT $2
    `, [phoneNumber, limit]);
    
    return result.rows.reverse();
  } catch (error) {
    console.error('Error getting conversation history:', error);
    return [];
  }
}

// Initialize database on startup
initializeDatabase();

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      body.entry.forEach(async (entry) => {
        const changes = entry.changes[0];
        const value = changes.value;
        
        if (value.messages && value.messages[0]) {
          const message = value.messages[0];
          const from = message.from;
          const text = message.text.body;
          
          console.log(`Message from ${from}: ${text}`);

                        // Save incoming message to database
              await saveMessage(from, text, 'user');
          
          // Get AI response (con soporte para Claude opcional)
          const aiResponse = await getResponse(text);
          
          // Send response back
          await sendWhatsAppMessage(from, aiResponse);
                        
              // Save bot response to database
              await saveMessage(from, aiResponse, 'bot');
        }
      });
      
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('Error:', error);
    res.sendStatus(500);
  }
});

// Get response (usa Claude si está disponible, sino respuesta simple)
async function getResponse(message) {
  // Si existe ANTHROPIC_API_KEY, usa Claude
  if (ANTHROPIC_API_KEY) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{ role: 'user', content: message }]
        },
        {
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.content[0].text;
    } catch (error) {
      console.error('Claude API Error:', error.response?.data || error.message);
      // Si falla Claude, usa respuesta simple
      return getSimpleResponse(message);
    }
  } else {
    // Si no hay API key, usa respuestas simples
    return getSimpleResponse(message);
  }
}

// Respuestas simples sin IA
function getSimpleResponse(message) {
  const msg = message.toLowerCase();
  
  // Saludos
  if (msg.includes('hola') || msg.includes('hi') || msg.includes('hello')) {
    return '¡Hola! 👋 Soy el bot de talleres UNACH. ¿En qué puedo ayudarte?';
  }
  
  // Información de talleres
  if (msg.includes('taller') || msg.includes('curso')) {
    return 'Nuestros talleres disponibles:\n\n📚 Taller de Programación\n🎨 Taller de Diseño Gráfico\n💼 Taller de Emprendimiento\n\n¿Te gustaría más información sobre alguno?';
  }
  
  // Horarios
  if (msg.includes('horario') || msg.includes('hora')) {
    return '🕐 Horarios de atención:\n\nLunes a Viernes: 8:00 AM - 5:00 PM\nSábados: 9:00 AM - 2:00 PM\n\n¿Necesitas agendar una cita?';
  }
  
  // Ubicación
  if (msg.includes('ubicación') || msg.includes('ubicacion') || msg.includes('donde')) {
    return '📍 Nos encontramos en:\nUniversidad Autónoma de Chiapas\nTuxtla Gutiérrez, Chiapas\n\n¿Necesitas indicaciones?';
  }
  
  // Contacto
  if (msg.includes('contacto') || msg.includes('telefono') || msg.includes('teléfono')) {
    return '📞 Contacto:\n\nTeléfono: 961-123-4567\nEmail: talleres@unach.mx\n\n¿En qué más puedo ayudarte?';
  }
  
  // Inscripción
  if (msg.includes('inscri') || msg.includes('regist')) {
    return '📝 Para inscribirte:\n\n1. Visita nuestra oficina\n2. Llena el formulario de registro\n3. Realiza el pago correspondiente\n\n¿Tienes alguna duda?';
  }
  
  // Respuesta por defecto
  return `Gracias por tu mensaje: "${message}"\n\n¿Necesitas información sobre nuestros talleres? Escribe "talleres" para más información.\n\nTambién puedes preguntar sobre horarios, ubicación o contacto.`;
}

// Send message via WhatsApp
async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Message sent successfully');
  } catch (error) {
    console.error('WhatsApp API Error:', error.response?.data || error.message);
  }
}


// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));


// Admin credentials and 2FA storage
const ADMIN_EMAIL = 'nacho_bunbury@hotmail.com';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_PHONE = '+529612991499';
const twoFactorCodes = new Map(); // Store temporary 2FA codes

// Authentication endpoints
app.post('/api/auth/send-2fa', async (req, res) => {
  try {
    const { email, password, phoneNumber, method } = req.body;
    
    // Validate credentials
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    
    // Validate phone number if WhatsApp method
    if (method === 'whatsapp') {
      if (!phoneNumber) {
        return res.status(400).json({ error: 'Número de teléfono requerido para WhatsApp 2FA' });
      }
      
      // Normalize phone numbers: add +52 if only 10 digits
      let normalizedInput = phoneNumber.trim().replace(/[\s\-()]/g, '');
      if (normalizedInput.length === 10 && /^\d{10}$/.test(normalizedInput)) {
        normalizedInput = '52' + normalizedInput;
      } else {
        normalizedInput = normalizedInput.replace(/[^0-9]/g, '');
      }
      
      const normalizedAdmin = ADMIN_PHONE.replace(/[^0-9]/g, '');
      
      console.log('Phone validation:', {
        input: phoneNumber,
        normalizedInput,
        normalizedAdmin,
        match: normalizedInput === normalizedAdmin
      });
      // Normalize phone numbers for comparison
      
      if (normalizedInput !== normalizedAdmin) {
        return res.status(403).json({ 
          error: `Número de teléfono incorrecto. Este número no está asociado al administrador.`
        });
      }
    }
    
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with 5 minute expiration
    twoFactorCodes.set(email, {
      code: code,
      expiresAt: Date.now() + 5 * 60 * 1000,
      method: method
    });
    
    // Send code via WhatsApp
    if (method === 'whatsapp') {
      const message = `🔐 *Código de verificación*

Tu código de acceso al Panel de Administración es:

*${code}*

Válido por 5 minutos.`;            console.log('Sending WhatsApp 2FA code:', { to: ADMIN_PHONE, code });
      await sendWhatsAppMessage(ADMIN_PHONE, message);
      console.log('WhatsApp message sent successfully');
    } else {
      console.log('Email 2FA not implemented yet');
    }
    
    console.log(`2FA code generated: ${code}, sent to ${method}`);
    res.json({ success: true, message: `Código enviado a tu ${method === 'whatsapp' ? 'WhatsApp' : method}` });
  } catch (error) {
    console.error('Error sending 2FA:', error);
    res.status(500).json({ error: 'Error al enviar código: ' + error.message });
  }
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    const stored = twoFactorCodes.get(email);
    
    if (!stored) {
      return res.status(401).json({ error: 'Código no encontrado o expirado' });
    }
    
    if (Date.now() > stored.expiresAt) {
      twoFactorCodes.delete(email);
      return res.status(401).json({ error: 'Código expirado' });
    }
    
    if (stored.code !== code) {
      return res.status(401).json({ error: 'Código incorrecto' });
    }
    
    // Code is valid, delete it
    twoFactorCodes.delete(email);
    
    res.json({ success: true, message: 'Autenticación exitosa' });
  } catch (error) {
    console.error('Error verifying 2FA:', error);
    res.status(500).json({ error: 'Error al verificar código' });
  }
});

// API Endpoints for Admin Panel

// Get dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalUsersResult = await pool.query('SELECT COUNT(*) FROM users');
    const messagesTodayResult = await pool.query(
      `SELECT COUNT(*) FROM conversations 
       WHERE DATE(timestamp) = CURRENT_DATE`
    );
    const activeConversationsResult = await pool.query(
      `SELECT COUNT(DISTINCT user_id) FROM conversations 
       WHERE timestamp > NOW() - INTERVAL '24 hours'`
    );
    
    res.json({
      totalUsers: parseInt(totalUsersResult.rows[0].count),
      messagesToday: parseInt(messagesTodayResult.rows[0].count),
      activeConversations: parseInt(activeConversationsResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Error getting stats' });
  }
});

// Get all conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const result = await pool.query(`
      SELECT c.*, u.phone_number 
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      ORDER BY c.timestamp DESC
      LIMIT $1
    `, [limit]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ error: 'Error getting conversations' });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, 
             COUNT(c.id) as message_count
      FROM users u
      LEFT JOIN conversations c ON u.id = c.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Error getting users' });
  }
});

// Get conversation history for a specific user
app.get('/api/conversations/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const conversations = await getConversationHistory(phoneNumber, 50);
    res.json(conversations);
  } catch (error) {
    console.error('Error getting user conversations:', error);
    res.status(500).json({ error: 'Error getting user conversations' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
