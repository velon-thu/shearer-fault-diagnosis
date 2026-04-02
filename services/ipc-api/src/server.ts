import { buildApp } from "./app";

const app = buildApp();

const start = async () => {
  try {
    await app.listen({
      host: "0.0.0.0",
      port: 18080,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
