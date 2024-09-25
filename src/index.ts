import { WebSocket, MessageEvent } from 'ws';
import { BSON } from 'bson';

/**
 * 一个简单的RPC客户端类，使用WebSocket进行通信。
 */
export class simple_rpc_client {
    private websocket_client: WebSocket;
    private status: boolean = false;
    private root: RPCNode = new RPCNode();
    private readonly server_cache: TimedCache<string, RPCServer>;
    private bin_first: boolean;

    /**
     * 获取服务器缓存
     */
    get _server_cache() {
        return this.server_cache;
    }

    /**
     * 构造函数，初始化RPC客户端。
     * @param ssl 是否使用SSL
     * @param url 服务器URL
     * @param token 认证令牌
     * @param bin_first 是否优先使用二进制消息
     */
    public constructor(ssl: boolean = false, url: string, token: string = '', bin_first: boolean = false) {
        const that: simple_rpc_client = this;
        this.server_cache = new TimedCache(
            120000,
            (key, value) => {
                const request = new APIResponse(key, 408, 'Request timeout');
                const re = value.handle(request);
                if (re != null) {
                    this.send(re);
                }
            },
            60000
        );
        this.bin_first = bin_first;
        this.websocket_client = new WebSocket(encodeURI(`${ssl ? "ws" : "wss"}://${url}${token.length === 0 ? `?token=${token}` : ""}`));
        this.websocket_client.binaryType = "arraybuffer"; // 使用数组类型二进制数据
        this.websocket_client.on('open', () => {
            this.status = true;
        });
        this.websocket_client.on('error', err => {
            console.error(err);
        });
        this.websocket_client.onmessage = (event: MessageEvent) => {
            let data: APIResponse | null = null;
            if (event.data instanceof ArrayBuffer) {
                const buffer = new Uint8Array(event.data);
                data = this.handleBin(buffer);
            } else if (typeof event.data === 'string') {
                data = this.handleStr(event.data);
            }
            if (data != null) {
                this.handle(data);
            } else {
                console.error("SimpleRPC: Data parsing failed");
            }
        };
        this.root.rpcServer = {
            handle(request: APIResponse): APIResponse | null {
                const server = that.server_cache.get(request.UUID);
                if (server === undefined) {
                    return null;
                }
                that.server_cache.remove(request.UUID);
                const re = server.handle(request);
                if (re instanceof APIResponse) {
                    that.send(re);
                }
                return null;
            }
        }
    }

    /**
     * 关闭WebSocket连接
     */
    public close() {
        this.websocket_client.close();
    }

    /**
     * 获取连接状态
     * @returns 当前连接状态
     */
    public getStatus(): boolean {
        return this.status;
    }

    /**
     * 处理字符串消息
     * @param message 接收到的字符串消息
     * @returns 解析后的API响应对象
     */
    private handleStr(message: string): APIResponse {
        const data = JSON.parse(message);
        return Object.assign(new APIResponse(), data);
    }

    /**
     * 处理二进制消息
     * @param message 接收到的二进制消息
     * @returns 解析后的API响应对象
     */
    private handleBin(message: Uint8Array): APIResponse {
        const data = BSON.deserialize(message);
        return Object.assign(new APIResponse(), data);
    }

    /**
     * 处理API响应数据
     * @param data API响应数据
     */
    private handle(data: APIResponse) {
        const key = data.key;
        if (key === '') {
            this.root.rpcServer?.handle(data);
            return;
        }
        const keys = key.split('.');
        let node: RPCNode = this.root;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!node.getChildren().has(key)) {
                console.error(`SimpleRPC: No such node ${data.key}`);
                return;
            }
            node = node.getChildren().get(key)!;
        }
        const re = node.rpcServer?.handle(data);
        if (re instanceof APIResponse) {
            this.send(re);
        }
    }

    /**
     * 添加节点
     * @param key 节点键值
     * @param server 节点服务器
     */
    public addNode(key: string = '', server: RPCServer) {
        if (key === '') {
            console.error("SimpleRPC: key cannot be empty");
            return;
        }
        if (server === null) {
            console.error("SimpleRPC: server cannot be empty");
            return;
        }
        const keys = key.split('.');
        let node: RPCNode = this.root;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!node.getChildren().has(key)) {
                node.getChildren().set(key, RPCNode.create(key));
            }
            node = node.getChildren().get(key)!;
        }
        node.rpcServer = server;
    }

    /**
     * 移除节点
     * @param key 节点键值
     */
    public removeNode(key: string = "") {
        if (key === '') {
            console.error("SimpleRPC: key cannot be empty");
            return;
        }
        const keys = key.split('.');
        let lastNode = this.root;
        let node = this.root;
        let nowKey = '';
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            nowKey = key;
            lastNode = node;
            if (!node.getChildren().has(key)) {
                return;
            }
            node = node.getChildren().get(key)!;
        }
        lastNode.getChildren().delete(nowKey);
    }

    /**
     * 添加发送回调
     * @param uuid 唯一标识符
     * @param server 回调服务器
     */
    public addSendCallBack(uuid: string, server: RPCServer): void {
        this.server_cache.set(uuid, server);
    }

    /**
     * 发送消息
     * @param message 要发送的消息
     * @param useBin 是否使用二进制格式
     */
    public send(message: APIResponse, useBin: boolean = this.bin_first): void {
        if (this.websocket_client.OPEN) {
            if (useBin) {
                this.websocket_client.send(message.toBsonBin());
            } else {
                this.websocket_client.send(message.toJsonStr());
            }
        }
    }

    /**
     * 发送消息并设置回调
     * @param message 要发送的消息
     * @param useBin 是否使用二进制格式
     * @param server 回调服务器
     */
    public sendAndCallBack(message: APIResponse, useBin: boolean = this.bin_first, server: RPCServer) {
        this.addSendCallBack(message.UUID, server);
        this.send(message, useBin);
    }

}


export class APIResponse {
    /**
     * 定义一个UUID字段，用于标识当前APIResponse实例的唯一标识符
     * 该字段初始化为空字符串
     */
    UUID: string = '';

    /**
     * 定义一个状态码字段，默认值为200，用于表示操作的成功或失败等状态
     */
    status: number = 200;

    /**
     * 定义一个消息字段，用于存储操作过程中的信息或错误消息
     * 该字段初始化为空字符串
     */
    message: string = '';

    /**
     * 定义一个路径字段
     * 该字段初始化为空字符串
     */
    key: string = '';

    /**
     * 定义一个请求对象字段，用于存储当前请求的相关信息
     * 该字段初始化为空字符串
     */
    request: any = '';

    /**
     * 定义一个参数映射字段，用于存储调用过程中的各种参数
     */
    params: Map<string, any> = new Map<string, any>();

    constructor(
        UUID: string = '',
        status: number = 200,
        message: string = '',
        key: string = '',
        request: any = '',
        params: Map<string, any> = new Map<string, any>()
    ) {
        this.UUID = UUID;
        this.status = status;
        this.message = message;
        this.key = key;
        this.request = request;
        this.params = params;
    }

    /**
     * 转为JSON字符串
     * @return JSON字符串
     */
    public toJsonStr():string{
        return JSON.stringify(this);
    }

    /**
     * 转为BSON二进制数据
     * @return Uint8Array格式的BSON二进制数据
     */
    public toBsonBin():Uint8Array{
        return BSON.serialize(this);
    }


}
export interface RPCServer {
    handle(request: APIResponse): APIResponse | null ;
}

export class RPCNode {
    /**
     * 用于存储子节点的映射。
     */
    private children: Map<string, RPCNode> = new Map();

    /**
     * 节点的名称，默认值为空字符串。
     */
    private _name: string = '';

    /**
     * 关联的RPC服务器实例，默认值为null。
     */
    private _rpcServer: RPCServer | null = null;

    constructor(name: string = '', rpcServer: RPCServer | null = null) {
        this._name = name;
        this._rpcServer = rpcServer;
    }

    /**
     * 获取节点的名称。
     */
    get name(): string {
        return this._name;
    }
    public getChildren():Map<string, RPCNode>{
        return this.children;
    }

    /**
     * 设置节点的名称。
     */
    set name(value: string) {
        this._name = value;
    }

    /**
     * 获取关联的RPC服务实例。
     */
    get rpcServer(): RPCServer | null {
        return this._rpcServer;
    }

    /**
     * 设置关联的RPC服务实例。
     */
    set rpcServer(value: RPCServer | null) {
        this._rpcServer = value;
    }

    /**
     * 清空所有子节点。
     */
    public clear(): void {
        this.children.clear();
    }

    /**
     * 静态工厂方法，创建一个新的RPCRouterNode实例。
     *
     * @param key 新节点的名称
     * @return 一个带有指定名称的新RPCRouterNode实例
     */
    static create(key: string): RPCNode {
        return new RPCNode(key, null);
    }
}
// 定义缓存项类型，用于存储实际值和过期时间
export type CacheItem<T> = {
    value: T;        // 缓存的值
    expiry: number;  // 缓存项的过期时间戳
};

/**
 * 一个具有过期时间和自动清理功能的定时缓存类
 * @template K 缓存键的类型
 * @template V 缓存值的类型
 */
export class TimedCache<K, V> {
    private cache: Map<K, CacheItem<V>>;  // 存储缓存项的Map
    private intervalId: number;           // 定时器ID，用于定期清理过期缓存

    /**
     * 构造函数，初始化缓存和定时器
     * @param ttl 缓存项的生存时间（毫秒）
     * @param onClear 缓存项过期时的回调函数，接收键和值作为参数
     * @param interval 清理定时器的间隔时间（毫秒），默认为60000毫秒（1分钟）
     */
    constructor(private ttl: number, private onClear: (key: K, value: V) => void, private interval: number = 60000) {
        this.cache = new Map<K, CacheItem<V>>();
        // 设置定时器，定期调用clearExpired方法清理过期缓存项
        this.intervalId = window.setInterval(() => this.clearExpired(), interval);
    }

    /**
     * 设置缓存项
     * @param key 缓存键
     * @param value 缓存值
     */
    set(key: K, value: V): void {
        const expiry = Date.now() + this.ttl;  // 计算缓存项的过期时间
        this.cache.set(key, { value, expiry });  // 将键值对和过期时间存入缓存
    }

    /**
     * 获取缓存项
     * @param key 缓存键
     * @returns 返回缓存的值，如果缓存已过期则返回undefined
     */
    get(key: K): V | undefined {
        const item = this.cache.get(key);
        // 如果缓存项存在且未过期，则返回其值，否则删除并返回undefined
        if (item && item.expiry > Date.now()) {
            return item.value;
        } else {
            this.cache.delete(key);
            return undefined;
        }
    }

    /**
     * 删除指定缓存项
     * @param key 要删除的缓存键
     */
    remove(key:K):void{
        this.cache.delete(key);  // 从缓存中删除指定键的项
    }

    /**
     * 私有方法，用于清理所有过期的缓存项
     */
    private clearExpired(): void {
        const now = Date.now();  // 当前时间戳
        // 遍历缓存项，如果项已过期，则触发onClear回调并删除该项
        for (const [key, item] of this.cache.entries()) {
            if (item.expiry <= now) {
                this.onClear(key, item.value);
                this.cache.delete(key);
            }
        }
    }

    /**
     * 清空整个缓存，并停止定时清理任务
     */
    clear(): void {
        window.clearInterval(this.intervalId);  // 停止定时清理任务
        this.cache.clear();  // 清空缓存
    }
}
