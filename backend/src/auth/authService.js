'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { signInstructorToken } = require('./jwt');

const SALT_ROUNDS = 10;

/**
 * Simple, real (not stubbed) email+password instructor auth: bcrypt-hashed
 * passwords, JWT issued on successful login. Deliberately minimal - no
 * password reset flow, no email verification - but the primitives (hashing,
 * signing) are production-grade libraries used correctly.
 */
class AuthService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async register({ email, password }) {
    if (!email || !password || password.length < 8) {
      throw new Error('Email and a password of at least 8 characters are required');
    }
    const existing = await this.repository.getInstructorByEmail(email);
    if (existing) {
      throw new Error('An account with that email already exists');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const instructor = {
      id: uuidv4(),
      email: email.toLowerCase(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    await this.repository.createInstructor(instructor);
    const token = signInstructorToken(instructor);
    return { instructor: publicInstructor(instructor), token };
  }

  async login({ email, password }) {
    const instructor = await this.repository.getInstructorByEmail(email || '');
    if (!instructor) {
      throw new Error('Invalid email or password');
    }
    const valid = await bcrypt.compare(password || '', instructor.passwordHash);
    if (!valid) {
      throw new Error('Invalid email or password');
    }
    const token = signInstructorToken(instructor);
    return { instructor: publicInstructor(instructor), token };
  }
}

function publicInstructor(instructor) {
  return { id: instructor.id, email: instructor.email, createdAt: instructor.createdAt };
}

module.exports = { AuthService };
