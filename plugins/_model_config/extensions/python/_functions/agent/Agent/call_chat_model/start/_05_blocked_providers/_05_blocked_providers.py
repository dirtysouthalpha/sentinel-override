from helpers import settings

@extension.patch
async def call_chat_model(original, agent, **kwargs):
    # Get blocked providers from settings
    blocked = settings.get("blocked_providers", [])
    if not blocked:
        return await original(agent=agent, **kwargs)
    
    # Check current chat model provider
    from helpers import model_config
    chat_config = model_config.get_chat_model_config(agent)
    provider = chat_config.get("provider", "")
    
    # Check if provider is blocked
    if any(blocked.lower() in provider.lower() for blocked in [blocked]):
        raise Exception(f"Provider '{provider}' is blocked in settings. Current blocked providers: {blocked}")
    
    # Check API base for blocked domains
    api_base = chat_config.get("api_base", "")
    for blocked in blocked:
        if blocked.lower() in api_base.lower():
            raise Exception(f"API base '{api_base}' contains blocked domain '{blocked}'")
    
    return await original(agent=agent, **kwargs)
