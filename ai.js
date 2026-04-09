#!/usr/bin/env node
import Groq from "groq-sdk";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let currentDir = process.cwd();

// ─── TOOLS DEFINITION ────────────────────────────────────────────────────────
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read content of a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with content",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit part of a file by replacing old text with new text",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string", description: "Exact text to replace" },
          new_text: { type: "string", description: "New text to insert" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and folders in a directory",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory path (default: current dir)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or folder (recursive)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description: "Move or rename a file or folder",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_file",
      description: "Search for a keyword inside a file, returns matching lines",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          keyword: { type: "string" },
        },
        required: ["path", "keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_file_info",
      description: "Get file metadata: size, last modified, type",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_directory",
      description: "Change current working directory",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run any shell command (git, npm, python, mkdir, etc.)",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
];

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────────────
function executeTool(name, args) {
  try {
    if (name === "read_file") {
      const target = path.resolve(currentDir, args.path);
      return { success: true, content: fs.readFileSync(target, "utf-8") };
    }

    if (name === "write_file") {
      const target = path.resolve(currentDir, args.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, "utf-8");
      return { success: true, message: `Written: ${target}` };
    }

    if (name === "edit_file") {
      const target = path.resolve(currentDir, args.path);
      let content = fs.readFileSync(target, "utf-8");
      if (!content.includes(args.old_text)) {
        return { error: "old_text not found in file" };
      }
      content = content.replace(args.old_text, args.new_text);
      fs.writeFileSync(target, content, "utf-8");
      return { success: true, message: `Edited: ${target}` };
    }

    if (name === "list_files") {
      const dir = args.directory ? path.resolve(currentDir, args.directory) : currentDir;
      const files = fs.readdirSync(dir).map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        const size = stat.isFile() ? ` (${(stat.size / 1024).toFixed(1)}KB)` : "";
        return `${stat.isDirectory() ? "[dir]" : "[file]"} ${f}${size}`;
      });
      return { success: true, directory: dir, files };
    }

    if (name === "delete_file") {
      const target = path.resolve(currentDir, args.path);
      fs.rmSync(target, { recursive: true, force: true });
      return { success: true, message: `Deleted: ${target}` };
    }

    if (name === "move_file") {
      const from = path.resolve(currentDir, args.from);
      const to = path.resolve(currentDir, args.to);
      fs.renameSync(from, to);
      return { success: true, message: `Moved: ${from} → ${to}` };
    }

    if (name === "search_in_file") {
      const target = path.resolve(currentDir, args.path);
      const content = fs.readFileSync(target, "utf-8");
      const matches = content
        .split("\n")
        .map((text, i) => ({ line: i + 1, text }))
        .filter((l) => l.text.includes(args.keyword));
      return { success: true, matches, total: matches.length };
    }

    if (name === "get_file_info") {
      const target = path.resolve(currentDir, args.path);
      const stat = fs.statSync(target);
      return {
        success: true,
        path: target,
        size: `${(stat.size / 1024).toFixed(2)} KB`,
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
        isDirectory: stat.isDirectory(),
      };
    }

    if (name === "change_directory") {
      const target = path.resolve(currentDir, args.path);
      if (!fs.existsSync(target)) {
        return { error: `Directory not found: ${target}` };
      }
      if (!fs.statSync(target).isDirectory()) {
        return { error: `Not a directory: ${target}` };
      }
      currentDir = target;
      return { success: true, message: `Changed to: ${currentDir}` };
    }

    if (name === "run_command") {
      const output = execSync(args.command, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: currentDir,
      });
      return { success: true, output: output || "(no output)" };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── SYSTEM PROMPT (dynamic — always reflects current dir) ───────────────────
function getSystemMessage() {
  return {
    role: "system",
    content: `You are an AI system monitor and assistant with full file system access.
Current working directory: ${currentDir}
OS: ${process.platform}

RULES:
- Only use tools when the user explicitly asks about files, folders, or commands
- For general conversation, reply normally without calling any tools
- Always use valid complete JSON arguments when calling tools
- Resolve relative paths from the current working directory
- Execute tasks directly without asking for confirmation`,
  };
}

// ─── CHAT LOOP ────────────────────────────────────────────────────────────────
const messages = [];

async function chat(userInput) {
  messages.push({ role: "user", content: userInput });

  while (true) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [getSystemMessage(), ...messages],
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log("\n🤖", msg.content, "\n");
      break;
    }

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      console.log(`\n⚙️  ${call.function.name}(${JSON.stringify(args)})`);

      const result = executeTool(call.function.name, args);
      const preview = JSON.stringify(result);
      console.log(`   → ${preview.length > 200 ? preview.slice(0, 200) + "…" : preview}`);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`🚀 AI System Monitor | dir: ${currentDir}`);
console.log(`   model: llama-3.3-70b-versatile | type 'exit' to quit\n`);

function ask() {
  rl.question(`[${path.basename(currentDir)}] you: `, async (input) => {
    const text = input.trim();
    if (!text) return ask();
    if (text === "exit") {
      console.log("bye!");
      rl.close();
      return;
    }

    try {
      await chat(text);
    } catch (err) {
      console.error("error:", err.message);
    }
    ask();
  });
}

ask();