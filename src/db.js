const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'u303362642_crypto_gateway',
  process.env.DB_USER || 'u303362642_crypto_gateway',
  process.env.DB_PASSWORD || '7vzhFkAlX$',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    dialect: 'mysql',
    logging: false,
    define: {
      timestamps: false,
    },
  }
);

const Invoice = require('./models/invoice')(sequelize, DataTypes);
const Transaction = require('./models/transaction')(sequelize, DataTypes);

Invoice.hasMany(Transaction, { foreignKey: 'invoice_id' });
Transaction.belongsTo(Invoice, { foreignKey: 'invoice_id' });

module.exports = {
  sequelize,
  Invoice,
  Transaction,
};
