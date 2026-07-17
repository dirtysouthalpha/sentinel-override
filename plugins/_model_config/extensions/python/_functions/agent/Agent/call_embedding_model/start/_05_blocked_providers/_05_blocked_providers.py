from helpers import settings

@extension.patch
async def call_embedding_model(original, agent, **kwargs):
    # Get blocked providers from settings
    blocked = settings.get("blocked_providers", [])
    if not blocked:
        return await original(agent=agent, **kwargs)
    
    # Check current embedding model provider
    from helpers import model_config
    embedding_config = model_config.get_embedding_model_config(agent)
    provider = embedding_config.get("provider", "")
    
    # Check if provider is blocked
    if any(blocked.lower() in provider.lower() for blocked in [blocked]):
        raise Exception(f"Provider '{provider}' is blocked in settings. Current blocked providers: {blocked}")
    
    # Check API base for blocked domains  
    api_base = embedding_config.get("api_base", "")
    for blocked in blocked:
        if blocked.lower() in api_base.lower():
            raise Exception(f"API base '{api_base}' contains blocked domain '{blocked}'")
    
    return await original(agent=agent, **kwargs)
