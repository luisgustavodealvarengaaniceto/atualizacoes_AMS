# Use uma imagem oficial do Node.js como base
FROM node:18-alpine as build

# Defina o diretório de trabalho dentro do container
WORKDIR /app

# Copie os arquivos de package e instale as dependências
COPY package*.json ./
RUN npm install

# Instalar o crypto-browserify para evitar erros de crypto
RUN npm install crypto-browserify

# Copie o restante dos arquivos
COPY . .

# Execute o build do Vite (React)
RUN npm run build

# Use a imagem do Nginx para servir os arquivos
FROM nginx:alpine

# Copie os arquivos gerados pelo build para o Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Exponha a porta 80 para acessar o site
EXPOSE 80

# Inicie o Nginx
CMD ["nginx", "-g", "daemon off;"]