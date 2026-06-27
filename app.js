const express = require('express');
const dotenv = require('dotenv');
const routes = require('./src/routes');
const { sequelize } = require('./src/db');
const { startInvoiceWatcher } = require('./src/services/paymentWatcher');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

sequelize.sync({ alter: true }).then(async () => {
//   await startInvoiceWatcher();
  app.listen(port, () => {
    console.log(`Crypto payment gateway listening on http://localhost:${port}`);
  });
}).catch((error) => {
  console.error('Unable to connect to the database:', error);
  process.exit(1);
});
