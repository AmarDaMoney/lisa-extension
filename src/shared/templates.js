/**
 * LISA Conversation Templates
 * Pre-built prompts for common tasks
 * v0.49-beta
 */

const LISA_TEMPLATES = {
  codeReview: {
    id: 'code-review',
    title: '🔍 Code Review',
    category: 'development',
    prompt: `Please review this code for:
- Security vulnerabilities
- Performance issues
- Best practices
- Code maintainability

Code:
\`\`\`
[PASTE YOUR CODE HERE]
\`\`\``,
    description: 'Get comprehensive code review feedback'
  },

  documentation: {
    id: 'documentation',
    title: '📚 Generate Documentation',
    category: 'development',
    prompt: `Create comprehensive documentation for this code:

\`\`\`
[PASTE YOUR CODE HERE]
\`\`\`

Include:
- Purpose and overview
- Parameters and return values
- Usage examples
- Edge cases and limitations`,
    description: 'Auto-generate code documentation'
  },

  debugging: {
    id: 'debugging',
    title: '🐛 Debug Helper',
    category: 'development',
    prompt: `I'm getting this error:
\`\`\`
[PASTE ERROR MESSAGE HERE]
\`\`\`

Context/Code:
\`\`\`
[PASTE RELEVANT CODE HERE]
\`\`\`

Please help me:
1. Identify the root cause
2. Explain why it's happening
3. Provide a fix with explanation`,
    description: 'Debug errors with context'
  },

  explain: {
    id: 'explain',
    title: '💡 Explain Like I\'m 5',
    category: 'learning',
    prompt: `Please explain this concept in simple terms that a beginner can understand:

[TOPIC/CONCEPT HERE]

Break it down with:
- Simple analogies
- Clear examples
- No jargon (or explain technical terms)`,
    description: 'Simplify complex concepts'
  },

  summarize: {
    id: 'summarize',
    title: '📝 Summarize Text',
    category: 'productivity',
    prompt: `Please summarize this text in [SHORT/MEDIUM/DETAILED] form:

[PASTE TEXT HERE]

Focus on:
- Key points and main ideas
- Important details
- Actionable insights`,
    description: 'Extract key information from text'
  },

  improve: {
    id: 'improve',
    title: '✨ Improve Writing',
    category: 'writing',
    prompt: `Please improve this text for:
- Clarity and readability
- Grammar and style
- Professional tone
- Conciseness

Original text:
[PASTE TEXT HERE]`,
    description: 'Enhance writing quality'
  },

  translate: {
    id: 'translate',
    title: '🌍 Translate & Localize',
    category: 'productivity',
    prompt: `Please translate this to [TARGET LANGUAGE]:

[PASTE TEXT HERE]

Additionally:
- Maintain the original tone
- Consider cultural context
- Keep formatting intact`,
    description: 'Professional translation with context'
  },

  compare: {
    id: 'compare',
    title: '⚖️ Compare Options',
    category: 'analysis',
    prompt: `Help me compare these options:

Option A: [DESCRIBE]
Option B: [DESCRIBE]

Please analyze:
- Pros and cons of each
- Use cases and scenarios
- Recommendation based on my needs: [DESCRIBE YOUR NEEDS]`,
    description: 'Structured comparison analysis'
  },

  brainstorm: {
    id: 'brainstorm',
    title: '💭 Brainstorm Ideas',
    category: 'creativity',
    prompt: `I need creative ideas for:

[DESCRIBE YOUR GOAL/PROJECT]

Context:
- Target audience: [DESCRIBE]
- Constraints: [LIST ANY]
- Goals: [WHAT YOU WANT TO ACHIEVE]

Please provide diverse, actionable ideas.`,
    description: 'Generate creative solutions'
  },

  learn: {
    id: 'learn',
    title: '🎓 Learning Path',
    category: 'learning',
    prompt: `I want to learn: [TOPIC/SKILL]

My current level: [BEGINNER/INTERMEDIATE/ADVANCED]
Time available: [DAILY/WEEKLY HOURS]
Learning style: [VISUAL/HANDS-ON/READING/etc]

Please create:
1. Structured learning roadmap
2. Resource recommendations
3. Practice exercises
4. Milestone checkpoints`,
    description: 'Personalized learning roadmap'
  }
};

// Categories for filtering
const TEMPLATE_CATEGORIES = {
  all: 'All',
  development: '💻 Development',
  productivity: '⚡ Productivity',
  writing: '✍️ Writing',
  learning: '📖 Learning',
  analysis: '📊 Analysis',
  creativity: '🎨 Creativity'
};

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LISA_TEMPLATES, TEMPLATE_CATEGORIES };
}
