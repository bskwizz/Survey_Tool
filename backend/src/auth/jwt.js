'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

function signInstructorToken(instructor) {
  return jwt.sign(
    { sub: instructor.id, email: instructor.email, role: 'instructor' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function verifyInstructorToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signInstructorToken, verifyInstructorToken };
