/**
 * @fileoverview Mongoose User model — ownership root for TRACE documents.
 */
import mongoose from 'mongoose'

const DEFAULT_RESEARCH_PREFERENCES = {
  preferredSources: [],
  defaultPaperTypes: [],
  defaultDomain: '',
}

const defaultResearchPreferencesSchema = new mongoose.Schema(
  {
    preferredSources: {
      type: [String],
      default: [],
    },
    defaultPaperTypes: {
      type: [String],
      default: [],
    },
    defaultDomain: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
)

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name must be at most 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    avatar: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: {
        values: ['researcher', 'admin'],
        message: 'Role must be either researcher or admin',
      },
      default: 'researcher',
    },
    preferences: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    defaultResearchPreferences: {
      type: defaultResearchPreferencesSchema,
      default: () => ({ ...DEFAULT_RESEARCH_PREFERENCES }),
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
)

userSchema.index({ isActive: 1, createdAt: -1 }, { name: 'active_users' })

/**
 * Strip sensitive fields from JSON / API serialization.
 */
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password
    delete ret.__v
    return ret
  },
})

const User = mongoose.model('User', userSchema)

export default User
export { DEFAULT_RESEARCH_PREFERENCES }
