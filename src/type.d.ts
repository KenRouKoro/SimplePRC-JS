import {BSON} from "bson";

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
    public toJsonStr():string{
        return JSON.stringify(this);
    }
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
    static create(key: string): RPCRouterNode {
        return new RPCRouterNode(key, null);
    }
}
export type CacheItem<T> = {
    value: T;
    expiry: number;
};

export class TimedCache<K, V> {
    private cache: Map<K, CacheItem<V>>;
    private intervalId: number;

    constructor(private ttl: number, private onClear: (key: K, value: V) => void, private interval: number = 60000) {
        this.cache = new Map<K, CacheItem<V>>();
        this.intervalId = window.setInterval(() => this.clearExpired(), interval);
    }

    set(key: K, value: V): void {
        const expiry = Date.now() + this.ttl;
        this.cache.set(key, { value, expiry });
    }

    get(key: K): V | undefined {
        const item = this.cache.get(key);
        if (item && item.expiry > Date.now()) {
            return item.value;
        } else {
            this.cache.delete(key);
            return undefined;
        }
    }

    remove(key:K):void{
        this.cache.delete(key);
    }

    private clearExpired(): void {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (item.expiry <= now) {
                this.onClear(key, item.value);
                this.cache.delete(key);
            }
        }
    }

    clear(): void {
        window.clearInterval(this.intervalId);
        this.cache.clear();
    }
}