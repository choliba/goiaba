import ollama, { type Message, type Tool } from 'ollama'

// …


type ToolName = 'add' | 'multiply' | 'escolha'

function add(a: number, b: number): number {
  return a + b
}

function multiply(a: number, b: number): number {
  return a * b
}

function escolha(a: number, b: number): number {
  console.log('escolha:', a, b)
  return a * b
}


const availableFunctions: Record<ToolName, (a: number, b: number) => number> = {
  add,
  multiply,
  escolha
}

const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'integer', description: 'The first number' },
          b: { type: 'integer', description: 'The second number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multiply',
      description: 'Multiply two numbers',
      parameters: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'integer', description: 'The first number' },
          b: { type: 'integer', description: 'The second number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escolha',
      description: 'Multiply two numbers',
      parameters: {
        type: "object",
        required: ['a', 'b'],
        properties: {
          a: { type: 'integer', description: 'letra a' },
          b: { type: 'integer', description: 'letra b' },
        },
      },
    },
  } as Tool,
]

async function agentLoop() {

  const messages: Message[] = [
    {
      role: 'user',
      content: `questions": {
    "intent": {
      "type": "choice",
      "instructions": "Which listed support intent best matches the customer message?",
      "criteria": {
        "duplicate_charge": "The customer reports being charged more than once.",
        "cancel_subscription": "The customer wants to end or downgrade a subscription.",
        "card_declined": "The customer reports a payment that failed or was declined.",
        "none": "None of the listed intents matches."
      }
    },
    "refund": {
      "type": "noul",
      "instructions": "Does the customer explicitly ask for a refund?"
    }
  }
      `
    },
  ]





  while (true) {
    const response = await ollama.chat({

      model: 'instructor:latest',
      messages,
      tools,
      think: true,
      options: {

      }
    })

    messages.push(response.message)
    console.log('Thinking:', response.message.thinking)
    console.log('Content:', response.message.content)

    const toolCalls = response.message.tool_calls ?? []
    if (toolCalls.length) {
      for (const call of toolCalls) {
        const fn = availableFunctions[call.function.name as ToolName]
        if (!fn) {
          continue
        }

        const args = call.function.arguments as { a: number; b: number }
        console.log(`Calling ${call.function.name} with arguments`, args)
        const result = fn(args.a, args.b)
        console.log(`Result: ${result}`)
        messages.push({ role: 'tool', tool_name: call.function.name, content: String(result) })
      }
    } else {
      break
    }
  }
}

agentLoop().catch(console.error)
