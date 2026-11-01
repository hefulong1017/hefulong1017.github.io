function E_max=f(m,n,x_1,x_2,t_1,t_2,a,s)
format long e
  m=input('m=');
  n=input('n=');
  x_1=1;
  x_2=2;
   s=0.1;
  a=2;
  t_1=0;
  t_2=1;
 h_1=(x_2-x_1)/m;
 h_2=s/n;
 r=a*h_2/(h_1^2);
 N=floor(t_2/h_2);
 x=(x_1+(0:m)*h_1)';
 t=(0+(-n:N)*h_2)';
 u=zeros(length(t),length(x));
 v=zeros(length(t),length(x));
 b=zeros(m-1,1);
 G=@(x,t) 3*(t^2)*(x^4-5*x)-24*(x^2)*(t^3+6)-(x^4-5*x)^2*((t-0.1)^3+6)^2-(x^4-5*x)^3*((t-0.1)^3+6)^3;
 
 
 for i=1:N
     u(i,1)=-4*(t(length(t)-i+1)^3+6);
     u(i,length(x))=6*(t(length(t)-i+1)^3+6);
 end
 for i=N+1:length(t)
     for j=1:length(x)
        u(i,j)=(x(j)^4-5*x(j))*(t(length(t)-i+1)^3+6);
     end
 end
 
 A=diag(((55/36)+2*r)*linspace(1,1,m-1))+diag(((11/72)-r)*linspace(1,1,m-2),-1)+diag(((11/72)-r)*linspace(1,1,m-2),1);
 B=diag((5/2)*linspace(1,1,m-1))+diag((1/4)*linspace(1,1,m-2),-1)+diag((1/4)*linspace(1,1,m-2),1);
 C=diag((-5/4)*linspace(1,1,m-1))+diag((-1/8)*linspace(1,1,m-2),-1)+diag((-1/8)*linspace(1,1,m-2),1);
 D=diag((5/18)*linspace(1,1,m-1))+diag((1/36)*linspace(1,1,m-2),-1)+diag((1/36)*linspace(1,1,m-2),1);

 
 for i=1:length(t)
     for j=1:length(x)
         v(i,j)=(x(j)^4-5*x(j))*(t(length(t)-i+1)^3+6);
     end
 end
u(N,2:length(x)-1)=v(N,2:length(x)-1);
u(N-1,2:length(x)-1)=v(N-1,2:length(x)-1);


for k=N-2:-1:1
    for i=2:m-2
       b(1)=-(11/72-r)*u(k,1)+(1/4)*u(k+1,1)+(-1/8)*u(k+2,1)+(1/36)*u(k+3,1)+  h_2*((1/12)*(u(k+n,1)^2+u(k+n,1)^3+G(x(1),t(length(t)-k+1)))+(10/12)*(u(k+n,2)^2+u(k+n,2)^3+G(x(2),t(length(t)-k+1)))+(1/12)*(u(k+n,3)^2+u(k+n,3)^3+G(x(3),t(length(t)-k+1))));
       b(m-1)=-(11/72-r)*u(k,length(x))+(1/4)*u(k+1,length(x))+(-1/8)*u(k+2,length(x))+(1/36)*u(k+3,length(x))+  h_2*((1/12)*(u(k+n,m-1)^2+u(k+n,m-1)^3+G(x(m-1),t(length(t)-k+1)))+(10/12)*(u(k+n,m)^2+u(k+n,m)^3+G(x(m),t(length(t)-k+1)))+(1/12)*(u(k+n,m+1)^2+u(k+n,m+1)^3+G(x(m+1),t(length(t)-k+1))));
       b(i)=h_2*((1/12)*(u(k+n,i)^2+u(k+n,i)^3+G(x(i),t(length(t)-k+1)))+(10/12)*(u(k+n,i+1)^2+u(k+n,i+1)^3+G(x(i+1),t(length(t)-k+1)))+(1/12)*(u(k+n,i+2)^2+u(k+n,i+2)^3+G(x(i+2),t(length(t)-k+1))));
    end
    u(k,2:length(x)-1)=chase(A,(B*u(k+1,2:length(x)-1)'+C*u(k+2,2:length(x)-1)'+D*u(k+3,2:length(x)-1)'+b));             
end


 for i=1:length(t)
     for j=1:length(x)
         v(i,j)=(x(j)^4-5*x(j))*(t(length(t)-i+1)^3+6);
     end
 end
 abs(u-v);
 E_max=max(max(abs(u-v)));