/**
 * Standardized Workflow Patterns - Inspired by Gemini-CLI
 * Common workflow interfaces and patterns for all agents
 */

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  error?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowPattern {
  name: string;
  description: string;
  steps: WorkflowStep[];
  currentStep: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
}

/**
 * Standard 5-Step Software Engineering Workflow (from Gemini-CLI)
 */
export const SOFTWARE_ENGINEERING_WORKFLOW: WorkflowPattern = {
  name: 'Software Engineering Task',
  description: 'Comprehensive workflow for software engineering tasks',
  steps: [
    {
      id: 'understand',
      name: 'Understand',
      description: 'Analyze the request and understand the codebase context',
      status: 'pending'
    },
    {
      id: 'plan',
      name: 'Plan',
      description: 'Build a coherent plan based on understanding',
      status: 'pending'
    },
    {
      id: 'implement',
      name: 'Implement',
      description: 'Execute the plan using available tools',
      status: 'pending'
    },
    {
      id: 'verify_tests',
      name: 'Verify (Tests)',
      description: 'Run tests to verify changes work correctly',
      status: 'pending'
    },
    {
      id: 'verify_standards',
      name: 'Verify (Standards)',
      description: 'Run linting and type-checking to ensure code quality',
      status: 'pending'
    }
  ],
  currentStep: 0,
  status: 'not_started'
};

/**
 * Subconscious Reasoning Workflow (Coquette Innovation)
 */
export const SUBCONSCIOUS_REASONING_WORKFLOW: WorkflowPattern = {
  name: 'Subconscious Reasoning',
  description: 'Deep thinking workflow before action',
  steps: [
    {
      id: 'understanding',
      name: 'Understanding',
      description: 'What is the user REALLY asking for?',
      status: 'pending'
    },
    {
      id: 'complexity',
      name: 'Complexity Assessment',
      description: 'How complex is this request?',
      status: 'pending'
    },
    {
      id: 'strategy',
      name: 'Strategy Planning',
      description: 'What is the optimal step-by-step approach?',
      status: 'pending'
    },
    {
      id: 'challenges',
      name: 'Challenge Identification',
      description: 'What potential complications exist?',
      status: 'pending'
    },
    {
      id: 'context',
      name: 'Context Analysis',
      description: 'What additional context is needed?',
      status: 'pending'
    },
    {
      id: 'acknowledgment',
      name: 'Acknowledgment Strategy',
      description: 'How to communicate thinking process to user?',
      status: 'pending'
    },
    {
      id: 'execution',
      name: 'Execution Planning',
      description: 'What is the precise execution plan?',
      status: 'pending'
    },
    {
      id: 'validation',
      name: 'Validation Strategy',
      description: 'How will we know if the approach works?',
      status: 'pending'
    }
  ],
  currentStep: 0,
  status: 'not_started'
};

/**
 * Tool Safety Workflow (Enhanced from Gemini-CLI)
 */
export const TOOL_SAFETY_WORKFLOW: WorkflowPattern = {
  name: 'Tool Safety Check',
  description: 'Safety verification before tool execution',
  steps: [
    {
      id: 'classify_danger',
      name: 'Classify Danger Level',
      description: 'Determine if tool operation is potentially dangerous',
      status: 'pending'
    },
    {
      id: 'explain_operation',
      name: 'Explain Operation',
      description: 'Describe what the tool will do and its impact',
      status: 'pending'
    },
    {
      id: 'check_paths',
      name: 'Check File Paths',
      description: 'Verify file paths are safe and appropriate',
      status: 'pending'
    },
    {
      id: 'log_safety',
      name: 'Log Safety Info',
      description: 'Record safety explanation for debugging',
      status: 'pending'
    },
    {
      id: 'execute_safely',
      name: 'Execute Safely',
      description: 'Perform the operation with safety monitoring',
      status: 'pending'
    }
  ],
  currentStep: 0,
  status: 'not_started'
};

/**
 * Personality Interpretation Workflow (Coquette Innovation)
 */
export const PERSONALITY_INTERPRETATION_WORKFLOW: WorkflowPattern = {
  name: 'Personality Interpretation',
  description: 'Transform technical response through personality',
  steps: [
    {
      id: 'load_personality',
      name: 'Load Personality',
      description: 'Load and cache personality configuration',
      status: 'pending'
    },
    {
      id: 'analyze_context',
      name: 'Analyze Context',
      description: 'Understand conversation context and history',
      status: 'pending'
    },
    {
      id: 'preserve_accuracy',
      name: 'Preserve Accuracy',
      description: 'Ensure technical facts remain unchanged',
      status: 'pending'
    },
    {
      id: 'apply_tone',
      name: 'Apply Tone',
      description: 'Transform presentation through character personality',
      status: 'pending'
    },
    {
      id: 'validate_consistency',
      name: 'Validate Consistency',
      description: 'Ensure response maintains character consistency',
      status: 'pending'
    }
  ],
  currentStep: 0,
  status: 'not_started'
};

/**
 * Workflow Manager Class
 */
export class WorkflowManager {
  private workflows: Map<string, WorkflowPattern> = new Map();

  constructor() {
    // Register default workflows
    this.registerWorkflow('software_engineering', SOFTWARE_ENGINEERING_WORKFLOW);
    this.registerWorkflow('subconscious_reasoning', SUBCONSCIOUS_REASONING_WORKFLOW);
    this.registerWorkflow('tool_safety', TOOL_SAFETY_WORKFLOW);
    this.registerWorkflow('personality_interpretation', PERSONALITY_INTERPRETATION_WORKFLOW);
  }

  registerWorkflow(name: string, workflow: WorkflowPattern): void {
    this.workflows.set(name, { ...workflow });
  }

  getWorkflow(name: string): WorkflowPattern | undefined {
    const workflow = this.workflows.get(name);
    return workflow ? { ...workflow } : undefined;
  }

  startWorkflow(name: string): WorkflowPattern | null {
    const workflow = this.getWorkflow(name);
    if (!workflow) return null;

    workflow.status = 'in_progress';
    workflow.currentStep = 0;
    workflow.steps[0].status = 'in_progress';
    workflow.steps[0].startTime = new Date();

    return workflow;
  }

  completeStep(workflow: WorkflowPattern, stepId: string, metadata?: Record<string, any>): boolean {
    const stepIndex = workflow.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) return false;

    const step = workflow.steps[stepIndex];
    step.status = 'completed';
    step.endTime = new Date();
    if (metadata) step.metadata = metadata;

    // Move to next step if available
    if (stepIndex < workflow.steps.length - 1) {
      workflow.currentStep = stepIndex + 1;
      workflow.steps[stepIndex + 1].status = 'in_progress';
      workflow.steps[stepIndex + 1].startTime = new Date();
    } else {
      // Workflow completed
      workflow.status = 'completed';
    }

    return true;
  }

  failStep(workflow: WorkflowPattern, stepId: string, error: string): boolean {
    const stepIndex = workflow.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) return false;

    const step = workflow.steps[stepIndex];
    step.status = 'failed';
    step.endTime = new Date();
    step.error = error;
    workflow.status = 'failed';

    return true;
  }

  skipStep(workflow: WorkflowPattern, stepId: string, reason?: string): boolean {
    const stepIndex = workflow.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) return false;

    const step = workflow.steps[stepIndex];
    step.status = 'skipped';
    step.endTime = new Date();
    if (reason) step.metadata = { skip_reason: reason };

    // Move to next step if available
    if (stepIndex < workflow.steps.length - 1) {
      workflow.currentStep = stepIndex + 1;
      workflow.steps[stepIndex + 1].status = 'in_progress';
      workflow.steps[stepIndex + 1].startTime = new Date();
    } else {
      // Workflow completed
      workflow.status = 'completed';
    }

    return true;
  }

  getWorkflowStatus(workflow: WorkflowPattern): {
    overall: string;
    currentStep: string;
    progress: number;
    timeElapsed: number;
  } {
    const completedSteps = workflow.steps.filter(step => 
      step.status === 'completed' || step.status === 'skipped'
    ).length;
    
    const progress = (completedSteps / workflow.steps.length) * 100;
    
    const currentStep = workflow.steps[workflow.currentStep];
    const startTime = workflow.steps.find(step => step.startTime)?.startTime;
    const timeElapsed = startTime ? Date.now() - startTime.getTime() : 0;

    return {
      overall: workflow.status,
      currentStep: currentStep?.name || 'Unknown',
      progress: Math.round(progress),
      timeElapsed: Math.round(timeElapsed / 1000) // seconds
    };
  }

  /**
   * Generate workflow-based prompts with standardized structure
   */
  generateWorkflowPrompt(workflowName: string, currentContext: string): string {
    const workflow = this.getWorkflow(workflowName);
    if (!workflow) return currentContext;

    const stepsList = workflow.steps
      .map((step, index) => `${index + 1}. ${step.name}: ${step.description}`)
      .join('\n');

    return `${currentContext}

## Workflow: ${workflow.name}
${workflow.description}

Follow this systematic approach:
${stepsList}

Current focus: Step ${workflow.currentStep + 1} - ${workflow.steps[workflow.currentStep]?.name}

Proceed systematically through each step, ensuring thorough completion before moving to the next.`;
  }
}

// Export singleton instance
export const workflowManager = new WorkflowManager();