# Line Protection Simulator — production image.
# Stage 1 builds the static app with Node; the final image is unprivileged
# nginx plus dist/ only (no Node, Vite, source or node_modules). Non-root,
# plain HTTP on 8080 behind the host's nginx. See SPEC.md § Deployment.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
