const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Birthdays = sequelize.define('birthday', {
	userId: {
		type: Sequelize.STRING,
		allowNull: false,
	},
	name: {
		type: Sequelize.STRING,
		allowNull: false,
	},
	dob: {
		type: Sequelize.DATE,
		allowNull: false,
	},
});

module.exports = Birthdays;