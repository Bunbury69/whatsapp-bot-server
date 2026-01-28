require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
          
          // Get AI response (con soporte para Claude opcional)
          const aiResponse = await getResponse(text);
          
          // Send response back
          await sendWhatsAppMessage(from, aiResponse);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
