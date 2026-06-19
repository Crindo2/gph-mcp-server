# Containerized Glama release for the GetPracticeHelp MCP server.
# Thin stdio proxy to the live remote endpoint; no data layer in the image.
FROM node:20-slim

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json ./
RUN npm install --omit=dev

# Application + embedded tool snapshot.
COPY entrypoint.mjs ./
COPY tools.json ./

CMD ["node", "entrypoint.mjs"]
