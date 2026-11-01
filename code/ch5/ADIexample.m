M=200;%网格数量
N=2000;%时间分割
T=0.05;%总时间
number = 50;%初始点数
tau=T./N;
L=1;
a=1;%导热系数决定的
h=L./M;
r=tau./h./h./2.*a.^2;%网比
disp(r);
H=sparse(diag(ones(1,M)*(2.*r+1)))+sparse(diag(ones(1,M-1)*(-r),1))+sparse(diag(ones(1,M-1)*(-r),-1));
v=zeros(M,M);
u=zeros(M,M);%初值
u(1,:)=0;u(M,:)=0;u(:,1)=0;u(:,M)=0;
[X,Y] = meshgrid(h:h:L,h:h:L);
RP = [randperm(M-2,number)'+1,randperm(M-2,number)'+1];%初始温度为100.0的点
for iter = 1:number
u(RP(iter,1),RP(iter,2)) = 100.0;
end
for k = 2:N
u(1,:)=0;u(M,:)=0;u(:,1)=0;u(:,M)=0;
delta_y=([zeros(M,1),u(:,1:M-1)]+[u(:,2:M),zeros(M,1)]-2*u)*r;
v=H\(u+delta_y);
v=v';
delta_x=([zeros(M,1),v(:,1:M-1)]+[v(:,2:M),zeros(M,1)]-2*v)*r;
u=H\(v+delta_x);
u=u';
u(1,:)=0;u(M,:)=0;u(:,1)=0;u(:,M)=0;
colormap(hot(10));
    contourf(h:h:L, (h:h:L)', u, 'ShowText','on');
    colorbar
    title('热传导初边值问题');
    hold off;
     frame=getframe(gcf);
    imind=frame2im(frame); [imind,cm] = rgb2ind(imind,256);
    if k==1
       imwrite(imind,cm,'test.gif','gif', 'Loopcount',inf,'DelayTime',1e-4);
    else
        if mod(k,100)==1
       imwrite(imind,cm,'test.gif','gif','WriteMode','append','DelayTime',1e-4);
       fprintf('epoch=%d\n',k);
        end
    end
end
