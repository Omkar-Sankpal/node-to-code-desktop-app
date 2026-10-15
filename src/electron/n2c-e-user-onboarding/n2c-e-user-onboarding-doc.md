This folder handles the user onboarding journey, 
The following things to be done here : 

Steps : 
1. Check if user has ollama installed 
    1.1. if no then install ollama and set it up on users device 
2. Check for the system configuration of the user 
    2.1 check the ram and free storage 
        if ram is 8+ gb and storage avaliable is 10+GB then enable gemma 4 e2b dowload option from ollama (non quantized)
        if ram 16+ GB and storage is 10+GB then enable gemma 4 e4b download option from ollama (non quantized)
        if ram 16+ GB and storage is also 10+GB then enable qwen3 8B download option ollama (Q4_K_M quantization) 
    2.2 The user should have an option to download the model (the checks above just enable or disable the download option end decision lies with user) 
3.  When user chooses a download option download the model from ollama itself 
    3.1 when user clicks download open ollama terminal and download the required model 
4. Once everything is setup user-onboarding is complete..!  