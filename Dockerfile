# Ravi Cash — runs the self-hosted server (no npm packages needed). Data lives in the /data volume.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY app ./app
COPY server ./server
COPY tools ./tools
RUN node tools/build.js && mkdir -p /data && chown -R node:node /data
# Starts as root only to fix the ownership of the mounted data disk, then runs as the unprivileged "node" user (uid 1000).
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data TRUST_PROXY=1 PUBLIC_HTTPS=1 RUN_AS_UID=1000
EXPOSE 8080
CMD ["node", "server/index.js"]
