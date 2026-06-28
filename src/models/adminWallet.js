module.exports = (sequelize, DataTypes) => {
  const AdminWallet = sequelize.define('AdminWallet', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      defaultValue: 'default',
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    private_key: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    network: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'bep20',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'admin_wallets',
    timestamps: false,
  });

  return AdminWallet;
};
