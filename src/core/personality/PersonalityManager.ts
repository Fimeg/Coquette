/**
 * Enhanced Personality Manager with short reminders and user character separation
 */

import { readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface PersonalityProfile {
  // Core identity
  name: string;
  description: string;
  
  // File paths
  fullPersonalityFile: string;
  shortReminderFile: string;
  
  // Behavior settings
  temperature: number;
  maxTokens: number;
  
  // Reminder frequency (how often to include short reminder)
  reminderFrequency: number; // every N exchanges
  fullPersonalityTriggers: string[]; // keywords that trigger full personality reload
}

export interface UserCharacter {
  name?: string;
  profession?: string;
  experience_level?: string;
  preferred_communication_style?: string;
  technical_background?: string;
  interests?: string[];
  context_notes?: string;
}

export interface PersonalityContext {
  shortReminder: string;
  fullPersonality?: string;
  userCharacter?: UserCharacter;
  lastFullReload: number;
  exchangeCount: number;
}

export class PersonalityManager {
  private personalities: Map<string, PersonalityProfile> = new Map();
  private contexts: Map<string, PersonalityContext> = new Map();
  private userCharacter?: UserCharacter;
  
  constructor() {
    this.loadBuiltInPersonalities();
  }

  async loadUserCharacter(): Promise<UserCharacter | undefined> {
    try {
      const userFile = join(homedir(), '.coquette', 'user-character.json');
      const content = await readFile(userFile, 'utf-8');
      this.userCharacter = JSON.parse(content);
      return this.userCharacter;
    } catch {
      // User character file is optional
      return undefined;
    }
  }

  async getPersonalityContext(
    personalityId: string,
    forceFullReload: boolean = false
  ): Promise<PersonalityContext> {
    const personality = this.personalities.get(personalityId);
    if (!personality) {
      throw new Error(`Personality ${personalityId} not found`);
    }

    let context = this.contexts.get(personalityId);
    if (!context) {
      // Initialize new context
      const shortReminder = await this.loadShortReminder(personality);
      context = {
        shortReminder,
        lastFullReload: 0,
        exchangeCount: 0,
        userCharacter: this.userCharacter
      };
      this.contexts.set(personalityId, context);
    }

    // Increment exchange count
    context.exchangeCount++;

    // Determine if we need full personality
    const needsFullPersonality = 
      forceFullReload ||
      context.exchangeCount === 1 || // First exchange
      context.exchangeCount % personality.reminderFrequency === 0 || // Regular intervals
      !context.fullPersonality; // Not yet loaded

    if (needsFullPersonality) {
      context.fullPersonality = await this.loadFullPersonality(personality);
      context.lastFullReload = Date.now();
    }

    return context;
  }

  buildPrompt(
    personalityId: string,
    context: PersonalityContext,
    useFullPersonality: boolean = false
  ): string {
    const personality = this.personalities.get(personalityId);
    if (!personality) return '';

    let prompt = '';

    // Add user character context if available
    if (context.userCharacter) {
      prompt += this.formatUserCharacter(context.userCharacter) + '\\n\\n';
    }

    // Add personality context
    if (useFullPersonality && context.fullPersonality) {
      prompt += context.fullPersonality;
    } else {
      prompt += `CHARACTER REMINDER: ${context.shortReminder}`;
    }

    return prompt;
  }

  shouldTriggerFullPersonality(
    personalityId: string,
    userInput: string,
    technicalResponse?: string
  ): boolean {
    const personality = this.personalities.get(personalityId);
    if (!personality) return false;

    const combinedText = (userInput + ' ' + (technicalResponse || '')).toLowerCase();
    
    return personality.fullPersonalityTriggers.some(trigger => 
      combinedText.includes(trigger.toLowerCase())
    );
  }

  // Private methods

  private loadBuiltInPersonalities(): void {
    // Ani - Technical but playful
    this.personalities.set('ani', {
      name: 'Ani',
      description: 'Technical but playful coding assistant',
      fullPersonalityFile: '~/.coquette/personalities/ani.txt',
      shortReminderFile: '~/.coquette/personalities/ani-reminder.txt',
      temperature: 0.7,
      maxTokens: 2048,
      reminderFrequency: 3, // Every 3rd exchange
      fullPersonalityTriggers: [
        'personality', 'character', 'behave', 'acting', 'style',
        'confused', 'not like you', 'different', 'change'
      ]
    });

    // Professional
    this.personalities.set('professional', {
      name: 'Professional',
      description: 'Formal technical consultant',
      fullPersonalityFile: '~/.coquette/personalities/professional.txt',
      shortReminderFile: '~/.coquette/personalities/professional-reminder.txt',
      temperature: 0.5,
      maxTokens: 2048,
      reminderFrequency: 5, // Every 5th exchange
      fullPersonalityTriggers: [
        'formal', 'business', 'enterprise', 'professional',
        'presentation', 'report', 'documentation'
      ]
    });

    // Casual
    this.personalities.set('casual', {
      name: 'Casual',
      description: 'Friendly and relaxed assistant',
      fullPersonalityFile: '~/.coquette/personalities/casual.txt',
      shortReminderFile: '~/.coquette/personalities/casual-reminder.txt',
      temperature: 0.8,
      maxTokens: 2048,
      reminderFrequency: 4, // Every 4th exchange
      fullPersonalityTriggers: [
        'friendly', 'casual', 'chill', 'relax', 'fun'
      ]
    });
  }

  private async loadShortReminder(personality: PersonalityProfile): Promise<string> {
    try {
      const filePath = personality.shortReminderFile.startsWith('~')
        ? join(homedir(), personality.shortReminderFile.slice(1))
        : personality.shortReminderFile;

      return await readFile(filePath, 'utf-8');
    } catch {
      // Fallback to generated reminder based on personality name
      return this.generateDefaultReminder(personality);
    }
  }

  private async loadFullPersonality(personality: PersonalityProfile): Promise<string> {
    try {
      const filePath = personality.fullPersonalityFile.startsWith('~')
        ? join(homedir(), personality.fullPersonalityFile.slice(1))
        : personality.fullPersonalityFile;

      return await readFile(filePath, 'utf-8');
    } catch (error) {
      console.warn(`Failed to load personality file for ${personality.name}: ${error}`);
      return this.generateDefaultReminder(personality);
    }
  }

  private generateDefaultReminder(personality: PersonalityProfile): string {
    switch (personality.name.toLowerCase()) {
      case 'ani':
        return 'Be technical but playful, use casual language, show enthusiasm for cool solutions, add gentle humor.';
      case 'professional':
        return 'Maintain formal tone, focus on business value, provide structured responses, consider enterprise needs.';
      case 'casual':
        return 'Be friendly and relaxed, use encouraging language, make coding feel approachable and fun.';
      default:
        return `Maintain the ${personality.name} personality style as defined.`;
    }
  }

  private formatUserCharacter(userChar: UserCharacter): string {
    const parts: string[] = [];
    
    if (userChar.name) parts.push(`User: ${userChar.name}`);
    if (userChar.profession) parts.push(`Profession: ${userChar.profession}`);
    if (userChar.experience_level) parts.push(`Experience: ${userChar.experience_level}`);
    if (userChar.technical_background) parts.push(`Background: ${userChar.technical_background}`);
    if (userChar.preferred_communication_style) parts.push(`Communication Style: ${userChar.preferred_communication_style}`);
    if (userChar.interests && userChar.interests.length > 0) parts.push(`Interests: ${userChar.interests.join(', ')}`);
    if (userChar.context_notes) parts.push(`Notes: ${userChar.context_notes}`);

    return parts.length > 0 ? `USER CONTEXT:\\n${parts.join('\\n')}` : '';
  }

  // Public utility methods
  
  async createUserCharacterTemplate(): Promise<string> {
    const template: UserCharacter = {
      name: 'Your Name',
      profession: 'Software Developer / Designer / etc.',
      experience_level: 'Beginner / Intermediate / Expert',
      technical_background: 'Languages/frameworks you know',
      preferred_communication_style: 'Direct / Detailed / Casual / etc.',
      interests: ['web development', 'AI/ML', 'design', 'etc.'],
      context_notes: 'Any specific preferences or context'
    };

    return JSON.stringify(template, null, 2);
  }

  getPersonalityList(): Array<{ id: string; profile: PersonalityProfile }> {
    return Array.from(this.personalities.entries()).map(([id, profile]) => ({
      id,
      profile
    }));
  }

  resetPersonalityContext(personalityId: string): void {
    this.contexts.delete(personalityId);
  }

  getContextStats(personalityId: string): { 
    exchanges: number; 
    lastFullReload: Date | null; 
    nextFullReload: number; 
  } | null {
    const context = this.contexts.get(personalityId);
    const personality = this.personalities.get(personalityId);
    
    if (!context || !personality) return null;

    const nextReload = personality.reminderFrequency - 
      (context.exchangeCount % personality.reminderFrequency);

    return {
      exchanges: context.exchangeCount,
      lastFullReload: context.lastFullReload ? new Date(context.lastFullReload) : null,
      nextFullReload: nextReload === personality.reminderFrequency ? 0 : nextReload
    };
  }
}