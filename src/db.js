const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'crypto_gateway',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
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
const AdminWallet = require('./models/adminWallet')(sequelize, DataTypes);

Invoice.hasMany(Transaction, { foreignKey: 'invoice_id' });
Transaction.belongsTo(Invoice, { foreignKey: 'invoice_id' });

module.exports = {
  sequelize,
  Invoice,
  Transaction,
  AdminWallet,
};
