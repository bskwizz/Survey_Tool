'use strict';

const { z } = require('zod');
const { registry } = require('../questionTypes/registry');

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createPresentationSchema = z.object({
  title: z.string().min(1).max(200),
});

const createQuestionSchema = z.object({
  presentationId: z.string().min(1),
  slideRef: z.string().min(1),
  type: z.enum(registry.list()),
  prompt: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).max(12).optional().default([]),
  allowMultiple: z.boolean().optional().default(false), // open_text only: same device may answer repeatedly
});

const updateQuestionSchema = z.object({
  prompt: z.string().min(1).max(500).optional(),
  options: z.array(z.string().min(1).max(200)).max(12).optional(),
  status: z.enum(['draft', 'collecting', 'closed']).optional(),
  showSynthesisOnSlide: z.boolean().optional(),
  allowMultiple: z.boolean().optional(),
});

const submitResponseSchema = z.object({
  questionId: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  participantToken: z.string().optional(), // may also arrive via header
});

module.exports = {
  registerSchema,
  loginSchema,
  createPresentationSchema,
  createQuestionSchema,
  updateQuestionSchema,
  submitResponseSchema,
};
