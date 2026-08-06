export async function helloWorkflow(name: string) {
  "use workflow";

  return createGreeting(name);
}

async function createGreeting(name: string) {
  "use step";

  const greeting = `Hello, ${name}!`;
  console.log(greeting);

  return { greeting, createdAt: new Date().toISOString() };
}
