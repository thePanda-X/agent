import { color } from "bun";
import chalk from "chalk";
import OpenAI from "openai";

const MODEL = "gemma4:e4b";
const cwd = process.cwd();

const SYSTEM_PROMPT = `You are a coding agent. 
The user will give you tasks about the project located in ${cwd}.`;

class colors {
    static user = chalk.hex("#00ff00").bold;
    static response = chalk.hex("#f5f5f5").bold;
    static thinking = chalk.hex("#6d6d6d").bold;
}

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

async function main() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || "ollama",
        baseURL: "http://localhost:11434/v1",
    });

    let messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT }
    ];

    const spinner = new Spinner();
    while (true) {
        const userInput = prompt(colors.user(" ➔ ")) || "";
        if (userInput.toLowerCase() === "/exit") {
            console.log(colors.response("Goodbye!"));
            break;
        }

        messages.push({ role: "user", content: userInput });

        const stream = await openai.chat.completions.create({
            model: MODEL,
            messages: messages,
            stream: true,
        });
        let fullResponse = "";
        spinner.start();
        for await (const part of stream) {
            const content = part.choices[0].delta?.content || "";
            fullResponse += content;
            if (content) {
                spinner.stop();
            }
            process.stdout.write(colors.response(content));
        }

        console.log();

        messages.push({ role: "assistant", content: fullResponse });
    }
}

main().catch((error) => {
    console.error("An error occurred:", error);
});