import time

import bpy


if __name__ == "__main__":
    bpy.context.scene.blendermcp_port = 9876
    bpy.ops.blendermcp.start_server()
    print("Blender MCP socket server is running on localhost:9876")
    while True:
        time.sleep(1)
