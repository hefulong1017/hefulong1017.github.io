for ii=1:4
m=10*2^(ii-1);
n=200*4^(ii-1);
xa=0;xb=1;
ta=0;tb=1;
h=(xb-xa)/m;
dt=(tb-ta)/n;
x=xa:h:xb;x=x';
t=ta:dt:tb;t=t';
u=zeros(m+1,n+1);
u(:,1)=sin(pi/4+(pi/2)*x);
u(1,:)=sqrt(2)/2*exp(-t);
u(m+1,:)=sqrt(2)/2*exp(-t);
r=dt/h^2;
row1=zeros(m-1,1);
row1(1,1)=-2;row1(2,1)=1;
A=toeplitz(row1);

for k=1:n
B=diag(u(2:m,k).^4);
        H=zeros(m-1,1);
        H(1,1)=r*u(1,k).*u(2,k).^4;
        H(m-1,1)=r*u(m+1,k).*u(m,k)^4;
        F=zeros(m-1,1);
        F(1:m-1,1)=f3(x(2:m),t(k));
        u(2:m,k+1)=u(2:m,k)+r*B*A*u(2:m,k)+H+dt*F ;
end
f=zeros(m+1,n+1);
for e=1:m+1
   for g=1:n+1
       f(e,g)=exp(-t(g))*sin(pi/4+(pi/2)*x(e));
   end
end
error=abs(u-f);
figure(1)
hold on
plot(x,error(1:m+1,n+1));
MaxErr(ii) = max(max(error));
disp(MaxErr(ii));
end
for j=1:3
    ord=MaxErr(j)/MaxErr(j+1);
    disp(ord);
end

figure(2)
plot(x,f(1:m+1,n+1));
figure(3)
plot(x,u(1:m+1,n+1));
[X, T] = meshgrid(x, t);
mesh(X, T, error');
