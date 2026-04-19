import chalk from "chalk";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import pathLib from "path";

const MODEL = "gemma4:26b";
const cwd = process.cwd();

class provider {
    baseURL: string;
    apiKey: string;

    constructor({ baseURL, apiKey }: { baseURL: string; apiKey: string }) {
        if (!baseURL || !apiKey) {
            throw new Error("Both baseURL and apiKey are required to initialize the provider.");
        }
        this.baseURL = baseURL;
        this.apiKey = apiKey;
    }
}

const useOpenRouter = false;


class colors {
    static user = chalk.hex("#00ff00").bold;
    static response = chalk.hex("#f5f5f5").bold;
    static thinking = chalk.hex("#6d6d6d").bold;
    static tool = chalk.hex("#ff7b00").bold;
}

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type tool = OpenAI.Chat.Completions.ChatCompletionTool;

class Spinner {
    private frames = ["■", "●", "◆", "◉"];
    private current = 0;
    private interval: NodeJS.Timeout | null = null;
    private active: boolean = false;

    start() {
        if (this.active) return;
        this.active = true;
        process.stdout.write(colors.thinking(this.frames[this.current]));
        this.interval = setInterval(() => {
            process.stdout.write(colors.thinking("\r" + this.frames[this.current] + " thinking..."));
            this.current = (this.current + 1) % this.frames.length;
        }, 100);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            process.stdout.write(colors.thinking("\r✓ Thinking     \n"));
        }
    }
}

function resolveAbsPath(pathStr: string): string {
    let normalizedPath = pathStr;

    if (pathStr.startsWith('~')) {
        normalizedPath = path.join(os.homedir(), pathStr.slice(1));
    }
    const absolutePath = path.resolve(normalizedPath);

    return absolutePath;
}


function ReadFileTool(filePath: string) {
    const fullPath = resolveAbsPath(filePath);
    try {
        const content = fs.readFileSync(fullPath, "utf-8");
        return { content };
    } catch (err) {
        return { error: `Error reading file: ${err}` };
    }
}

function PowerShellTool(command: string) {
    const bannedCommands = ["Remove-Item", "rm", "del", "rmdir", "rd", "format", "shutdown", "restart", "Stop-Process", "kill"];
    const lowerCommand = command.toLowerCase();
    for (const banned of bannedCommands) {
        if (lowerCommand.includes(banned.toLowerCase())) {
            const userInput = prompt(chalk.red(`The command contains a potentially dangerous operation: "${banned}".\n Do you want to proceed? (yes/no): `)) || "";
            if (userInput.toLowerCase() !== "yes") {
                return { error: `The command contains a banned operation: ${banned}` };
            }
        }
    }

    try {
        const result = Bun.spawnSync({
            cmd: ["powershell", "-Command", command],
            stdout: "pipe",
            stderr: "pipe",
        });
        if (result.exitCode === 0) {
            return { output: result.stdout.toString() };
        } else {
            return { error: result.stderr.toString() };
        }
    } catch (err) {
        return { error: `Error executing command: ${err}` };
    }
}

export function EditFileTool(path: string, oldStr: string, newStr: string) {
    const fullPath = resolveAbsPath(path);

    const dir = pathLib.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!oldStr) {
        fs.writeFileSync(fullPath, newStr, "utf-8");
        return { path: fullPath, action: "created_file_with_content" };
    }
    const originalContent = fs.readFileSync(fullPath, "utf-8");
    if (!originalContent.includes(oldStr)) {
        return { path: fullPath, action: "oldStr not found." };
    }
    const editedContent = originalContent.replace(oldStr, newStr);
    fs.writeFileSync(fullPath, editedContent, "utf-8");
    return { path: fullPath, action: "edited" };
}

function ListFilesTool(
    dirPath: string
): {
    filepath: string,
    allFiles: {
        filename: string,
        type: "file" | "directory"
    }[]
} {
    const fullPath = resolveAbsPath(dirPath);
    try {
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const allFiles = entries.map((entry) => ({
            filename: entry.name,
            type: entry.isDirectory() ? "directory" : "file" as "file" | "directory"
        }));
        return {
            filepath: fullPath,
            allFiles
        };
    } catch (err) {
        return {
            filepath: fullPath,
            allFiles: [],
        };
    }
}

const toolRegistry: Record<string, Function> = {
    [ReadFileTool.name]: (args: any) => ReadFileTool(args.filePath),
    [ListFilesTool.name]: (args: any) => ListFilesTool(args.dirPath),
    [PowerShellTool.name]: (args: any) => PowerShellTool(args.command),
    [EditFileTool.name]: (args: any) => EditFileTool(args.path, args.oldStr, args.newStr),
};

const tools: tool[] = [
    {
        type: "function",
        function: {
            name: ReadFileTool.name,
            description: "Reads the content of a file at the given path.",
            parameters: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "The path to the file to read." },
                },
                required: ["filePath"],
            }
        }
    },
    {
        type: "function",
        function: {
            name: ListFilesTool.name,
            description: "Lists all files and directories in the given directory path.",
            parameters: {
                type: "object",
                properties: {
                    dirPath: { type: "string", description: "The path to the directory to list." },
                },
                required: ["dirPath"],
            }
        }
    },
    {
        type: "function",
        function: {
            name: PowerShellTool.name,
            description: "Executes a PowerShell command and returns the output.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The PowerShell command to execute." },
                },
                required: ["command"],
            }
        }
    },
    {
        type: "function",
        function: {
            name: EditFileTool.name,
            description: "Replaces first occurrence of old_str with new_str in file. If old_str is empty, create/overwrite file with new_str.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "The path to the file to edit." },
                    oldStr: { type: "string", description: "The string to be replaced." },
                    newStr: { type: "string", description: "The string to replace with." },
                },
                required: ["path", "oldStr", "newStr"],
            }
        }
    }

];

async function handleToolCall(functionName: string, args: any): Promise<any> {

    const toolFunction = toolRegistry[functionName];
    if (!toolFunction) {
        return { error: `No tool found with name: ${functionName}` };
    }
    Bun.stdout.write(colors.tool(`\n ➔ Tool (${functionName})\n`));
    const result = await toolFunction(args);
    return result;
}


const SYSTEM_PROMPT = `
You are a coding agent whose goal it is to help us solve coding tasks.
Gather information about the tasks that the user requested,
Create a plan on how to solve the task, and execute the plan step by step.

You have access to the following tools:
${tools.map((tool: any) => `- ${tool.function.name}: ${tool.function.description}`).join("\n")}
`;


async function main() {
    const ollamaProvider = new provider({
        apiKey: "ollama",
        baseURL: "http://localhost:11434/v1",
    });

    const openaiProvider = new provider({
        apiKey: process.env.OPENROUTER_API_KEY || "",
        baseURL: "https://openrouter.ai/api/v1",
    });

    const activeProvider = useOpenRouter ? openaiProvider : ollamaProvider;

    const openai = new OpenAI({
        apiKey: activeProvider.apiKey,
        baseURL: activeProvider.baseURL,
    });

    let messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT }
    ];

    const spinner = new Spinner();
    while (true) {
        const userInput = prompt(colors.user("\n ➔ ")) || "";
        if (userInput.toLowerCase() === "/exit") {
            console.log(colors.response("Goodbye!"));
            break;
        }

        messages.push({ role: "user", content: userInput });

        let responseReceived = false;

        while (!responseReceived) {
            const stream = await openai.chat.completions.create({
                model: MODEL,
                messages: messages,
                stream: true,
                tools: tools,
            });

            let fullResponse = "";
            let toolCalls: any[] = [];

            spinner.start();
            for await (const part of stream) {
                const delta = part.choices[0].delta;
                const content = delta?.content || "";
                if (content) {
                    spinner.stop();
                    fullResponse += content;
                    process.stdout.write(colors.response(content));
                }

                if (delta?.tool_calls) {
                    spinner.stop();
                    for (const tcDelta of delta.tool_calls) {
                        const index = tcDelta.index;

                        if (!toolCalls[index]) {
                            toolCalls[index] = {
                                id: tcDelta.id || "",
                                type: "function",
                                function: {
                                    name: "",
                                    arguments: ""
                                }
                            };
                        }

                        if (tcDelta.id) {
                            toolCalls[index].id = tcDelta.id;
                        }

                        if (tcDelta.function?.name) {
                            toolCalls[index].function.name += tcDelta.function.name;
                        }

                        if (tcDelta.function?.arguments) {
                            toolCalls[index].function.arguments += tcDelta.function.arguments;
                        }
                    }
                }
            }

            if (toolCalls.length > 0) {
                messages.push({
                    role: "assistant",
                    tool_calls: toolCalls.map(tc => ({
                        id: tc.id,
                        type: "function",
                        function: tc.function
                    }))
                });

                for (const toolCall of toolCalls) {
                    const functionName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);

                    const result = await handleToolCall(functionName, args);

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                }

            } else {
                messages.push({ role: "assistant", content: fullResponse });
                responseReceived = true;
            }
        }
    }
}

main().catch((error) => {
    console.error("An error occurred:", error);
});