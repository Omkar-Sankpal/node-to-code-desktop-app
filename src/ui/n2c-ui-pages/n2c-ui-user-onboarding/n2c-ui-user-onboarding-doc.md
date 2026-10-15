The user-onboarding page

Global Instructions : 
1. The pages should be modular 
2. Naming conventions should be followed i.e file and folder names in src should start with "n2c-...." 
3. for every page there should be a folder : n2c-ui-<page-name> 
4. in every page folder there should be a main page file with all the html : n2c-ui-<page-name>-main.tsx 
5. the overall folder structure should look like : 
        |- n2c-ui-<page-name>
        |   |-n2c-ui-<page-name>-main.tsx
        |   |-n2c-ui-<page-name>-types.ts
        |   |-n2c-ui-<page-name>-hooks.ts

Current Page Instructions : 
0. This file talke with "src/electron/n2c-e-user-onboarding"
1. This page onboards the user it should be a popup style page when the user first opens the app.
    1.1 The main functions of this page is to signup user and setup ollama and model downloads 
2. The user should have 2 options : 
    2.1 Guest login -> storing local session on pc (ask nickname in that case)
    2.2 Sign up via Google -> this will be implemented lated (Keep a placeholder until then) 
3. Once the user signs up via google or guest : He should see a screen do setup ollama 
    3.1 If user already has ollama on his pc then direcltly move to downloading the model 
    3.2 Give user 3 model options which will be enabled or disabled according to the user pc specs
4. Keep a progress bar both for ollama download and model download 
4. Once the model is downloaded redirect user to the dashboard.